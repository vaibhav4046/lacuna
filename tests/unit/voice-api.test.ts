import { describe, expect, it } from 'vitest';

import {
  ElevenLabsVoiceProvider, MAX_STREAMING_AUDIO_BYTES, VoiceBoundary, addStreamingAudioBytes,
  boundedStreamingAudio, elevenLabsVoiceConfig, readSingleUseToken,
  readSpokenAnswer, singleUseTokenRequest, streamingSpeechRequest, validStreamingAudio,
  validateVoiceAccess, type ElevenLabsVoiceConfig, type VoiceAccessRequest,
} from '../../src/api/voice.js';

const CONFIG: ElevenLabsVoiceConfig = {
  apiKey: 'test-server-key', voiceId: 'voice_123',
  modelId: 'eleven_flash_v2_5', outputFormat: 'mp3_44100_128',
};

const PRIVATE: VoiceAccessRequest = {
  origin: 'https://lacuna.example', expectedOrigin: 'https://lacuna.example',
  scope: 'private', workspace: 'ws-a', sessionWorkspace: 'ws-a', sourceKey: '127.0.0.1',
};

describe('ElevenLabs request builders', () => {
  it('requires both the permanent server key and configured voice id', () => {
    expect(elevenLabsVoiceConfig({ ELEVENLABS_API_KEY: 'key' })).toBeNull();
    expect(elevenLabsVoiceConfig({ ELEVENLABS_VOICE_ID: 'voice' })).toBeNull();
    expect(elevenLabsVoiceConfig({
      ELEVENLABS_API_KEY: 'key', ELEVENLABS_VOICE_ID: 'my_voice',
    })).toMatchObject({ voiceId: 'my_voice', modelId: 'eleven_flash_v2_5' });
  });

  it('builds the official realtime Scribe single-use token request', () => {
    const request = singleUseTokenRequest(CONFIG);
    expect(request.url).toBe('https://api.elevenlabs.io/v1/single-use-token/realtime_scribe');
    expect(request.init.method).toBe('POST');
    expect(request.init.headers).toMatchObject({ 'xi-api-key': 'test-server-key' });
    expect(request.init.body).toBeUndefined();
  });

  it('builds streaming TTS with only text and model in its body', () => {
    const request = streamingSpeechRequest(CONFIG, 'The supported answer.');
    expect(request?.url).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/voice_123/stream?output_format=mp3_44100_128',
    );
    expect(JSON.parse(String(request?.init.body))).toEqual({
      text: 'The supported answer.', model_id: 'eleven_flash_v2_5',
    });
    expect(JSON.stringify(request?.init)).not.toContain('source text');
  });

  it('refuses empty and oversized TTS text', () => {
    expect(streamingSpeechRequest(CONFIG, ' ')).toBeNull();
    expect(streamingSpeechRequest(CONFIG, 'x'.repeat(5_001))).toBeNull();
  });
});

describe('ElevenLabs response guards', () => {
  it('accepts an opaque bounded token and rejects malformed token JSON', () => {
    expect(readSingleUseToken({ token: 'sutkn_12345678' })).toBe('sutkn_12345678');
    expect(readSingleUseToken({ token: '' })).toBeNull();
    expect(readSingleUseToken({ token: 'bad token' })).toBeNull();
    expect(readSingleUseToken({ token: 7 })).toBeNull();
  });

  it('accepts only a non-empty bounded audio stream', () => {
    const good = new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } });
    expect(validStreamingAudio(good)).toBe('audio/mpeg');
    expect(validStreamingAudio(new Response('{}', { headers: { 'content-type': 'application/json' } }))).toBeNull();
    expect(validStreamingAudio(new Response(null, { headers: { 'content-type': 'audio/mpeg' } }))).toBeNull();
    expect(validStreamingAudio(new Response('x', {
      headers: { 'content-type': 'audio/mpeg', 'content-length': String(13 * 1024 * 1024) },
    }))).toBeNull();
  });

  it('hard-caps chunked audio while it crosses the server', () => {
    expect(addStreamingAudioBytes(0, 1)).toBe(1);
    expect(addStreamingAudioBytes(MAX_STREAMING_AUDIO_BYTES - 1, 1))
      .toBe(MAX_STREAMING_AUDIO_BYTES);
    expect(addStreamingAudioBytes(MAX_STREAMING_AUDIO_BYTES, 1)).toBeNull();
    expect(addStreamingAudioBytes(Number.MAX_SAFE_INTEGER, 1)).toBeNull();
    expect(addStreamingAudioBytes(0, -1)).toBeNull();
  });

  it('cancels a chunked provider body before an over-limit chunk is exposed', async () => {
    const chunkBytes = 64 * 1024;
    let emitted = 0;
    let cancelled = false;
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        emitted += chunkBytes;
        controller.enqueue(new Uint8Array(chunkBytes));
      },
      cancel() {
        cancelled = true;
      },
    });
    const bounded = boundedStreamingAudio(new Response(source, {
      headers: { 'content-type': 'audio/mpeg' },
    }));
    expect(bounded).not.toBeNull();
    const consume = async () => {
      const reader = bounded!.body!.getReader();
      let received = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) return received;
        received += chunk.value.byteLength;
        expect(received).toBeLessThanOrEqual(MAX_STREAMING_AUDIO_BYTES);
      }
    };
    await expect(consume()).rejects.toThrow('streaming audio limit exceeded');
    expect(emitted).toBeGreaterThan(MAX_STREAMING_AUDIO_BYTES);
    expect(cancelled).toBe(true);
  });

  it('maps malformed token JSON and provider rate limits without returning provider bodies', async () => {
    const malformed = new ElevenLabsVoiceProvider(CONFIG, async () => new Response('{', {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    await expect(malformed.token()).resolves.toEqual({ ok: false, failure: 'provider_unavailable' });

    const limited = new ElevenLabsVoiceProvider(CONFIG, async () => new Response('provider secret detail', { status: 429 }));
    await expect(limited.token()).resolves.toEqual({ ok: false, failure: 'rate_limited' });
    await expect(limited.speech('answer')).resolves.toEqual({ ok: false, failure: 'rate_limited' });
  });

  it('maps malformed TTS content types to a redacted provider failure', async () => {
    const provider = new ElevenLabsVoiceProvider(CONFIG, async () => new Response('{"error":"credential"}', {
      headers: { 'content-type': 'application/json' },
    }));
    await expect(provider.speech('answer')).resolves.toEqual({ ok: false, failure: 'provider_unavailable' });
  });
});

describe('voice endpoint access and limits', () => {
  it('requires exact same origin and the authenticated private workspace', () => {
    expect(validateVoiceAccess(PRIVATE)).toBeNull();
    expect(validateVoiceAccess({ ...PRIVATE, origin: 'https://evil.example' })).toBe('origin');
    expect(validateVoiceAccess({ ...PRIVATE, sessionWorkspace: null })).toBe('session');
    expect(validateVoiceAccess({ ...PRIVATE, workspace: 'forged' })).toBe('workspace');
  });

  it('allows only the named public workspace on the public route', () => {
    const access = { ...PRIVATE, scope: 'public' as const, workspace: 'public', sessionWorkspace: null };
    expect(validateVoiceAccess(access)).toBeNull();
    expect(validateVoiceAccess({ ...access, workspace: 'private-target' })).toBe('workspace');
  });

  it('accepts exactly a spoken-answer body, never source or context fields', () => {
    expect(readSpokenAnswer({ text: 'Answer only.' })).toBe('Answer only.');
    expect(readSpokenAnswer({ text: 'Answer only.', source: 'private evidence' })).toBeNull();
    expect(readSpokenAnswer({ text: '' })).toBeNull();
  });

  it('rate limits token minting before spending another provider request', async () => {
    let calls = 0;
    const provider = new ElevenLabsVoiceProvider(CONFIG, async () => {
      calls += 1;
      return Response.json({ token: `sutkn_token_${calls}` });
    });
    const boundary = new VoiceBoundary(provider, () => 10_000);
    for (let count = 0; count < 8; count += 1) {
      expect((await boundary.token(PRIVATE)).status).toBe(200);
    }
    const ninth = await boundary.token(PRIVATE);
    expect(ninth.status).toBe(429);
    expect(ninth.kind === 'json' ? ninth.retryAfterSeconds : null).toBe(60);
    expect(calls).toBe(8);
  });

  it('returns a guarded streaming response without buffering it in the boundary', async () => {
    const audio = new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } });
    const provider = new ElevenLabsVoiceProvider(CONFIG, async (input) => {
      return String(input).includes('/text-to-speech/') ? audio : Response.json({ token: 'sutkn_token_123' });
    });
    const boundary = new VoiceBoundary(provider);
    const result = await boundary.speech(PRIVATE, { text: 'Supported answer.' });
    expect(result.kind).toBe('audio');
    if (result.kind === 'audio') {
      expect(result.response).not.toBe(audio);
      expect(result.response.body).not.toBeNull();
      expect(result.response.headers.get('content-type')).toBe('audio/mpeg');
    }
  });
});
