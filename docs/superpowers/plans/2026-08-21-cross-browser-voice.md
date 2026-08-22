# Cross-Browser Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make real TTS playback work through native browser audio even when Web Audio analysis is missing or rejected, while preserving cancellation, replay, and truthful failure states.

**Architecture:** `VoiceController` primes playback synchronously on every user gesture. `BrowserVoiceRuntime` owns one reusable `PlaybackSession` that treats native `HTMLAudioElement` playback as the sound path and Web Audio as optional metering. Controller state records whether metering is live, so the UI never invents a waveform when only native playback is available.

**Tech Stack:** TypeScript, React, browser `Audio`/`AudioContext`, Vitest fake browser primitives.

**Spec:** `docs/superpowers/specs/2026-08-21-production-convergence-design.md`

## Global Constraints

- Only a non-empty, size-bounded MP3 response may reach playback.
- Provider failures and local playback failures remain separate.
- Native playback must not depend on `AudioContext` or an analyser.
- No transcript, RMS, waveform, or audio may be simulated.
- Abort or disposal must prevent a stale continuation from starting audio.
- Heavy verification runs with one worker to protect the user's laptop.

---

### Task 1: Playback contract and controller gesture priming

**Files:**
- Modify: `web/src/voice/controller.ts`
- Test: `tests/unit/voice-controller.test.ts`

**Interfaces:**
- Produces: `PlaybackAnalysis = 'live' | 'unavailable'`
- Produces: `VoiceRuntime.preparePlayback(): void`
- Produces: `VoiceRuntime.dispose(): void`
- Changes: `PlaybackHandlers.started(analysis: PlaybackAnalysis): void`
- Adds: `RuntimeFailure` member `playback_blocked`
- Adds: `VoiceSnapshot.playbackAnalysis: PlaybackAnalysis | null`

- [ ] **Step 1: Write controller tests that require synchronous preparation**

Add call recording to the existing fake runtime and cover typed Ask and replay:

```ts
it('primes playback inside the typed user gesture before querying', async () => {
  const runtime = new FakeRuntime();
  const controller = new VoiceController(runtime);
  await controller.submitTyped('Where does session state live?');
  expect(runtime.calls.slice(0, 2)).toEqual(['preparePlayback', 'query']);
});

it('primes playback again for an explicit replay gesture', async () => {
  const runtime = new FakeRuntime();
  const controller = new VoiceController(runtime);
  await controller.submitTyped('Where does session state live?');
  runtime.calls.length = 0;
  await controller.replay();
  expect(runtime.calls[0]).toBe('preparePlayback');
});
```

- [ ] **Step 2: Write state tests for unavailable metering and blocked autoplay**

```ts
it('speaks without claiming a playback signal when metering is unavailable', async () => {
  runtime.playbackAnalysis = 'unavailable';
  await controller.submitTyped('Where does session state live?');
  expect(seen.some((s) => s.state === 'SPEAKING' && s.signal === null
    && s.playbackAnalysis === 'unavailable')).toBe(true);
});

it('keeps replay after the browser blocks native play', async () => {
  runtime.speechFailure = 'playback_blocked';
  await controller.submitTyped('Where does session state live?');
  expect(controller.snapshot).toMatchObject({
    state: 'ERROR', failure: 'playback_blocked', canReplay: true,
  });
});
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run: `npx vitest run tests/unit/voice-controller.test.ts --maxWorkers=1`

Expected: failures because the runtime contract, failure member, and snapshot field do not exist.

- [ ] **Step 4: Implement the minimal controller contract**

In `VoiceRuntime`, add the two lifecycle methods. Call `preparePlayback()` at the first synchronous line of `start()`, `submitTyped()`, and `replay()` after the busy/empty guards. `retry()` reaches `start()` or `replay()` and must not call it twice. Call `runtime.dispose()` from controller disposal.

Initialize and clear `playbackAnalysis` with the other audio fields. Use the analysis value passed to `started`:

```ts
started: (analysis) => {
  if (generation !== this.#generation) return;
  this.#move('playback_started');
  this.#update({
    playbackAnalysis: analysis,
    signal: analysis === 'live' ? 'playback' : null,
  });
},
```

Map `playback_blocked` through the ordinary `fail` event so the machine remains in `ERROR` and the more precise cause remains in `snapshot.failure`.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run: `npx vitest run tests/unit/voice-controller.test.ts --maxWorkers=1`

Expected: all controller tests pass.

- [ ] **Step 6: Commit the contract change**

```bash
git add web/src/voice/controller.ts tests/unit/voice-controller.test.ts
git commit -m "refactor(voice): prime reusable browser playback"
```

---

### Task 2: Native-first reusable playback session

**Files:**
- Create: `web/src/voice/playback.ts`
- Modify: `web/src/voice/browser.ts`
- Test: `tests/unit/voice-browser.test.ts`

**Interfaces:**
- Produces: `PlaybackSession.prepare(): void`
- Produces: `PlaybackSession.play(blob, handlers, signal): Promise<void>`
- Produces: `PlaybackSession.dispose(): void`
- Consumes: `PlaybackHandlers` and `PlaybackAnalysis` from `controller.ts`

- [ ] **Step 1: Add a native-only success regression**

Stub `Audio` with `play()` that emits `playing` and `ended`, remove `AudioContext` from globals, and assert:

```ts
await expect(runtime.speak('Supported answer.', handlers, signal)).resolves.toBeUndefined();
expect(started).toEqual(['unavailable']);
expect(frames).toEqual([]);
```

- [ ] **Step 2: Add analyser-failure and autoplay-rejection regressions**

The analyser case provides an `AudioContext` whose `createMediaElementSource()` throws and asserts native playback still completes. The autoplay case makes `Audio.play()` reject with `NotAllowedError` and expects `{ failure: 'playback_blocked' }`, not `provider_unavailable`.

- [ ] **Step 3: Add cancellation and disposal race regressions**

Use a deferred `play()` promise. Abort before it resolves and assert the element was paused, the object URL was revoked exactly once, and a later `playing` emission does not call `handlers.started`. Create a prepared context, call `runtime.dispose()`, and assert its `close()` runs once.

- [ ] **Step 4: Run the browser tests and verify RED**

Run: `npx vitest run tests/unit/voice-browser.test.ts --maxWorkers=1`

Expected: native-only playback fails because `playAudio` constructs `AudioContext` unconditionally; lifecycle methods are absent.

- [ ] **Step 5: Implement `PlaybackSession`**

Use a lazy context factory that checks standard and prefixed constructors without throwing when neither exists. `prepare()` invokes `resume()` immediately and stores a caught promise. `play()` must:

1. cancel the prior active element;
2. create and retain one object URL and native `Audio` element;
3. register `playing`, `ended`, `error`, and abort listeners before `play()`;
4. start optional metering only when the prepared context is running;
5. call `started('unavailable')` when native audio starts without metering;
6. translate a `NotAllowedError` rejection to `playback_blocked`;
7. clean every listener, node, animation frame, URL, and active reference exactly once.

Use an internal monotonically increasing generation so an old promise cannot mutate a later playback.

- [ ] **Step 6: Wire the runtime to the session**

Delete the old standalone `playAudio` function from `browser.ts`. Add one `PlaybackSession` field, forward `preparePlayback`, use it from `speak`, and forward `dispose`. Do not change speech acquisition or MP3 validation.

- [ ] **Step 7: Run focused browser and controller tests**

Run: `npx vitest run tests/unit/voice-browser.test.ts tests/unit/voice-controller.test.ts --maxWorkers=1`

Expected: all tests pass, including the prior acquisition timeout, provider mapping, socket closure, and abort tests.

- [ ] **Step 8: Commit native-first playback**

```bash
git add web/src/voice/playback.ts web/src/voice/browser.ts tests/unit/voice-browser.test.ts
git commit -m "fix(voice): fall back to native browser playback"
```

---

### Task 3: Truthful browser-audio recovery UI

**Files:**
- Modify: `web/src/app/routes/voice.tsx`
- Modify: `web/src/voice/states.ts`
- Test: `tests/unit/web-product-contracts.test.ts`
- Test: `tests/unit/voice-machine.test.ts`

**Interfaces:**
- Consumes: `VoiceSnapshot.playbackAnalysis`
- Consumes: failure `playback_blocked`

- [ ] **Step 1: Add UI contract assertions**

Require the blocked copy and sound-retry label while forbidding provider copy for that failure:

```ts
expect(voice).toContain("playback_blocked: 'Your browser blocked sound'");
expect(voice).toContain("'ENABLE SOUND'");
expect(voice).toContain("snapshot.playbackAnalysis === 'unavailable'");
expect(voice).toContain('AUDIO PLAYING · METER UNAVAILABLE');
```

Extend the machine parity test so the new runtime failure still maps to the existing `fail` transition rather than adding a second server state vocabulary.

- [ ] **Step 2: Run the UI tests and verify RED**

Run: `npx vitest run tests/unit/web-product-contracts.test.ts tests/unit/voice-machine.test.ts --maxWorkers=1`

Expected: missing copy, button, and analysis indicator.

- [ ] **Step 3: Implement the recovery presentation**

Add specific copy: `Your browser blocked sound. Select Enable sound to retry this real answer.` When `failure === 'playback_blocked' && canReplay`, label replay `ENABLE SOUND`; otherwise retain `PLAY ANSWER`. During `SPEAKING` with unavailable analysis, show `AUDIO PLAYING · METER UNAVAILABLE`, display level `—`, and leave the orb without a playback waveform.

- [ ] **Step 4: Run focused UI and all voice tests**

Run: `npx vitest run tests/unit/voice-machine.test.ts tests/unit/voice-controller.test.ts tests/unit/voice-browser.test.ts tests/unit/web-product-contracts.test.ts --maxWorkers=1`

Expected: all voice and UI contract tests pass.

- [ ] **Step 5: Commit the voice UI**

```bash
git add web/src/app/routes/voice.tsx web/src/voice/states.ts tests/unit/web-product-contracts.test.ts tests/unit/voice-machine.test.ts
git commit -m "fix(voice): expose truthful sound recovery"
```

---

### Task 4: Voice integration gate

**Files:**
- Modify only if evidence changes: `docs/V10_RELEASE_STATUS.md`
- Create after production proof: `artifacts/verification/2026-08-21-convergence/voice.json`

**Interfaces:**
- Consumes: deployed `/api/workspace/voice/speech`
- Produces: redacted production proof with HTTP status, content type, byte count, MP3 prefix, UI state, and whether analyser metering was available

- [ ] **Step 1: Run static and build gates**

Run: `npm run typecheck`

Run: `npm --prefix web run build`

Run: `npm run copy:lint`

Expected: all exit zero.

- [ ] **Step 2: Run the complete voice regression set**

Run: `npx vitest run tests/unit/voice-api.test.ts tests/unit/voice-browser.test.ts tests/unit/voice-controller.test.ts tests/unit/voice-machine.test.ts tests/unit/web-product-contracts.test.ts --maxWorkers=1`

Expected: all tests pass with no skips.

- [ ] **Step 3: Production-test after the combined preview deployment**

In the authenticated browser, submit a typed question, verify the speech request returns `200 audio/mpeg`, and exercise Play Answer. Record native playback success, or, if the automation browser blocks sound, record the truthful `ENABLE SOUND` recovery state while separately proving the valid MP3 response. Do not label an automation-surface block as provider failure.

- [ ] **Step 4: Commit verified evidence with the combined release**

Stage only the evidence and truthful status text produced by the actual deployment gate. Use commit subject `docs: record converged production evidence` in the final evidence task rather than creating a voice-only documentation commit.
