import { useEffect, useRef, useState } from 'react';
import { MONO } from '../design/mark';

/**
 * The voice orb.
 *
 * Everything that moves here is measured. The radius breathes on the RMS of
 * the current buffer, the ring at the equator is the time domain waveform
 * wrapped into a circle, the wave frequency and the violet intensity follow
 * the detected pitch, and a peak throws a brief amber spark. There is no
 * timer anywhere in this file: with no microphone the orb is static, and a
 * static orb is the honest picture of a product that is not listening.
 *
 * The microphone is requested on an explicit click and never before. Until
 * then the row reads VOICE · NOT CONFIGURED, which is what it is. The audio
 * never leaves the browser: there is no provider wired, nothing is uploaded,
 * and the readouts below the orb are computed from the same buffer that draws
 * it.
 *
 * The state chips light from real state only. LISTENING is on when a track is
 * live and delivering samples. The others stay dim because nothing behind
 * them exists yet, and lighting them on a timer is the exact dishonesty the
 * rest of this product refuses.
 */

type Chip = 'LISTENING' | 'TRANSCRIBING' | 'CHECKING CONTEXT' | 'SPEAKING' | 'NO EVIDENCE';
const CHIPS: readonly Chip[] = ['LISTENING', 'TRANSCRIBING', 'CHECKING CONTEXT', 'SPEAKING', 'NO EVIDENCE'];

const SIZE = 300;
const POINTS = 128;

/**
 * Autocorrelation over the time domain buffer. Returns hertz, or null when the
 * signal is too quiet or too noisy to claim a pitch. Claiming one anyway would
 * be a number nobody measured.
 */
function detectPitch(buffer: Float32Array, sampleRate: number): number | null {
  const size = buffer.length;
  let rms = 0;
  for (let i = 0; i < size; i += 1) rms += (buffer[i] ?? 0) ** 2;
  rms = Math.sqrt(rms / size);
  if (rms < 0.01) return null;

  // 80Hz to 400Hz is the speaking range this product cares about.
  const minLag = Math.floor(sampleRate / 400);
  const maxLag = Math.floor(sampleRate / 80);
  let bestLag = -1;
  let bestScore = 0;
  for (let lag = minLag; lag <= maxLag && lag < size; lag += 1) {
    let score = 0;
    for (let i = 0; i < size - lag; i += 1) score += (buffer[i] ?? 0) * (buffer[i + lag] ?? 0);
    score /= size - lag;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  if (bestLag < 0 || bestScore < 0.01) return null;
  return sampleRate / bestLag;
}

export function VoiceOrb() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [live, setLive] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const [pitch, setPitch] = useState<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // The static orb, drawn once and whenever the canvas appears. A product that
  // is not listening still has to look like something.
  useEffect(() => {
    if (live) return;
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.8);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    for (let i = 0; i < 260; i += 1) {
      const theta = i * 2.399963;
      const r = 96 * Math.sqrt(i / 260);
      ctx.globalAlpha = 0.20 + 0.25 * (i / 260);
      ctx.fillStyle = i % 37 === 0 ? '#8052FF' : '#5E5E5E';
      ctx.beginPath();
      ctx.arc(cx + Math.cos(theta) * r, cy + Math.sin(theta) * r, 1.1, 0, 6.283);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, [live]);

  useEffect(() => {
    if (!live) return;
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;

    const audio = new AudioContext();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.82;
    const time = new Float32Array(analyser.fftSize);
    let raf = 0;
    let source: MediaStreamAudioSourceNode | null = null;
    // Heavy, gravity-like smoothing. No springs, no bounce.
    let radius = 96;
    let violet = 0;
    const sparks: { x: number; y: number; born: number }[] = [];
    let cancelled = false;

    const stream = streamRef.current;
    if (stream !== null) {
      source = audio.createMediaStreamSource(stream);
      source.connect(analyser);
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 1.8);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let lastReadout = 0;

    const frame = (now: number) => {
      if (cancelled) return;
      raf = requestAnimationFrame(frame);
      analyser.getFloatTimeDomainData(time);

      let sum = 0;
      let peak = 0;
      for (let i = 0; i < time.length; i += 1) {
        const v = time[i] ?? 0;
        sum += v * v;
        if (Math.abs(v) > peak) peak = Math.abs(v);
      }
      const rms = Math.sqrt(sum / time.length);
      const hz = detectPitch(time, audio.sampleRate);

      // The readouts are throttled to something a person can read, not to
      // sixty changes a second. The value is still the measured one.
      if (now - lastReadout > 120) {
        lastReadout = now;
        setLevel(rms);
        setPitch(hz);
      }

      const target = 78 + Math.min(rms * 14, 1) * 46;
      radius += (target - radius) * 0.06;
      const targetViolet = hz === null ? 0 : Math.min(1, (hz - 80) / 320);
      violet += (targetViolet - violet) * 0.04;

      const cx = SIZE / 2;
      const cy = SIZE / 2;
      ctx.clearRect(0, 0, SIZE, SIZE);

      // The sphere.
      for (let i = 0; i < 260; i += 1) {
        const theta = i * 2.399963 + now * 0.00012;
        const r = radius * Math.sqrt(i / 260);
        ctx.globalAlpha = 0.22 + 0.4 * (i / 260);
        ctx.fillStyle = i % 37 === 0 ? '#8052FF' : '#5E5E5E';
        ctx.beginPath();
        ctx.arc(cx + Math.cos(theta) * r, cy + Math.sin(theta) * r, 1.1, 0, 6.283);
        ctx.fill();
      }

      // The waveform, wrapped into a ring at the equator.
      ctx.globalAlpha = 0.55 + violet * 0.4;
      ctx.strokeStyle = `rgb(${Math.round(94 + violet * 34)}, ${Math.round(94 - violet * 12)}, ${Math.round(94 + violet * 161)})`;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (let i = 0; i <= POINTS; i += 1) {
        const t = i / POINTS;
        const sample = time[Math.floor(t * (time.length - 1))] ?? 0;
        const wobble = sample * 34;
        const angle = t * 6.283;
        const r = radius + 12 + wobble;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // A peak throws one spark. Amber, brief, and only on a real transient.
      if (peak > 0.34 && sparks.length < 24) {
        const angle = Math.random() * 6.283;
        sparks.push({ x: cx + Math.cos(angle) * (radius + 12), y: cy + Math.sin(angle) * (radius + 12), born: now });
      }
      for (let i = sparks.length - 1; i >= 0; i -= 1) {
        const spark = sparks[i];
        if (spark === undefined) continue;
        const age = (now - spark.born) / 520;
        if (age >= 1) { sparks.splice(i, 1); continue; }
        ctx.globalAlpha = 1 - age;
        ctx.fillStyle = '#FFB829';
        ctx.beginPath();
        ctx.arc(spark.x, spark.y, 1.8 * (1 - age) + 0.6, 0, 6.283);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    raf = requestAnimationFrame(frame);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (source !== null) source.disconnect();
      analyser.disconnect();
      void audio.close();
    };
  }, [live]);

  // The track is stopped on unmount, so the browser's recording indicator goes
  // out when the screen does.
  useEffect(() => () => {
    const stream = streamRef.current;
    if (stream !== null) for (const track of stream.getTracks()) track.stop();
    streamRef.current = null;
  }, []);

  async function enable() {
    setProblem(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setLive(true);
    } catch {
      setProblem('Microphone permission was not granted.');
    }
  }

  function disable() {
    const stream = streamRef.current;
    if (stream !== null) for (const track of stream.getTracks()) track.stop();
    streamRef.current = null;
    setLive(false);
    setLevel(null);
    setPitch(null);
  }

  const dim = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.18em', color: '#5E5E5E' } as const;

  return (
    <>
      <canvas ref={canvasRef} style={{ width: 'min(300px, 100%)', aspectRatio: '1', flexShrink: 0 }} aria-hidden="true" />
      <div style={{ flex: 1, minWidth: '280px', display: 'flex', flexDirection: 'column', gap: '26px' }}>
        <div style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: live ? '#15846E' : '#5E5E5E' }}></span>
          <span style={{ fontFamily: MONO, fontSize: '10.5px', letterSpacing: '0.18em', color: '#BDBDBD' }}>VOICE · {live ? 'MICROPHONE LIVE' : 'NOT CONFIGURED'}</span>
          <span style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.12em', color: '#5E5E5E' }}>PROVIDER · NOT CONFIGURED · SPEECH ONLY · LACUNA KEEPS THE CONTEXT</span>
        </div>

        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
          {live ? (
            <button className="hv-edge35" onClick={disable} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '7px', cursor: 'pointer', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.16em', color: '#BDBDBD', padding: '9px 14px' }}>STOP THE MICROPHONE</button>
          ) : (
            <button className="hv-violet" onClick={() => void enable()} style={{ background: '#8052FF', border: 'none', borderRadius: '7px', cursor: 'pointer', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.16em', color: '#FFFFFF', padding: '9px 14px' }}>ENABLE MICROPHONE</button>
          )}
          <span style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.12em', color: '#5E5E5E' }}>LOCAL INPUT ONLY · AUDIO IS NOT SENT ANYWHERE</span>
        </div>
        {problem === null ? null : <span role="alert" style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.16em', color: '#BDBDBD' }}>{problem}</span>}

        <div style={{ display: 'flex', gap: 'clamp(14px, 3vw, 34px)', flexWrap: 'wrap', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.18em' }}>
          {CHIPS.map((c) => (
            <span key={c} style={{ color: live && c === 'LISTENING' ? '#FFFFFF' : '#5E5E5E', transition: 'color 400ms ease' }}>{c}</span>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px 22px', fontFamily: MONO, fontSize: '11px' }}>
          <span style={dim}>LEVEL</span>
          <span style={{ color: '#BDBDBD' }}>{level === null ? '—' : level.toFixed(3)}</span>
          <span style={dim}>PITCH</span>
          <span style={{ color: '#BDBDBD' }}>{pitch === null ? '—' : `${Math.round(pitch)} HZ`}</span>
        </div>

        <p style={{ fontSize: '14.5px', color: '#9A9A9A', margin: 0, maxWidth: '52ch' }}>Voice is another way into the same memory. When no provider is connected, text is still available. Listening and speaking motion binds to real audio amplitude only.</p>
      </div>
    </>
  );
}
