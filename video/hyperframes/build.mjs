import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Writes index.html from the narration the voice actually produced.
 *
 *   node narrate.mjs && node build.mjs && npx hyperframes check
 *
 * The film is cut to the voice rather than the voice squeezed into a guessed
 * layout: every scene's length is its own clip's measured duration plus a fixed
 * breath, so a re-recorded line moves the timeline instead of desynchronising
 * it. Nothing here is timed by hand, which is why there are no magic numbers
 * below except the breath and the pan targets.
 */

const ROOT = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const narration = JSON.parse(readFileSync(`${ROOT}narration.json`, 'utf8'));

/**
 * The continuity run, as it was printed.
 *
 * Recorded output rather than a recreation of it: the file is what
 * `npm run continuity` wrote, with the two lines that name a local path
 * dropped because they are noise on a screen, and nothing reworded. A terminal
 * drawn to look like a terminal would be a prop; this is a transcript, and it
 * is labelled as one.
 */
const CONTINUITY = readFileSync(`${ROOT}assets/continuity.txt`, 'utf8')
  .split(String.fromCharCode(10))
  .filter((line) => !line.includes('artifacts/continuity/one-context.json written'))
  .map((line) => line.replace(/\s+$/, ''))
  // Blank lines and the run's own heading are dropped so the whole transcript
  // fits one frame. Nothing that carries a result is touched.
  .filter((line) => line !== '' && !line.startsWith('One store, three clients'));

/** Space after each line, so a scene lands rather than being cut off. */
const BREATH = 1.4;
/** A held first frame, so the film does not start mid-word. */
const LEAD_IN = 0.8;

const seconds = Object.fromEntries(narration.scenes.map((scene) => [scene.id, scene.seconds]));

/**
 * The judge page as one tall capture, panned.
 *
 * Five scenes talk about five rows of the same page, and cutting between five
 * crops of one screenshot would be five cuts pretending to be five screens.
 * Panning is what a person reading the page actually does, and it keeps the
 * rows above and below in frame, which is the point: the outcomes differ.
 */
const JUDGE_SCALE = 2;
const JUDGE_W = Math.round(1440 * JUDGE_SCALE);
const JUDGE_H = Math.round(1758 * JUDGE_SCALE);
/** Row centres in the source capture, in its own pixels. */
const ROW_CENTRE = { s04: 450, s05: 670, s06: 880, s07: 1330, s08: 1530 };
/** The answer column in the source capture, in its own pixels. */
const COLUMN_LEFT = 340;
/** Where a row sits vertically: above the caption band, not behind it. */
const ROW_Y = 430;
const PAN = Object.fromEntries(Object.entries(ROW_CENTRE).map(([id, centre]) => [id, {
  x: Math.round(-COLUMN_LEFT * JUDGE_SCALE + 120),
  y: Math.round(ROW_Y - centre * JUDGE_SCALE),
}]));

const scenes = [
  { id: 's01', kind: 'open' },
  { id: 's02', kind: 'problem' },
  { id: 's03', kind: 'project' },
  { id: 's04', kind: 'judge', caption: 'CURRENT STATE', note: 'Answered, and the sources it rests on.' },
  { id: 's05', kind: 'judge', caption: 'REVISED', note: 'The replaced value stays readable as history.' },
  { id: 's06', kind: 'judge', caption: 'SOURCES DISAGREE', note: 'Both kept. Neither picked.' },
  { id: 's07', kind: 'judge', caption: 'NO EVIDENCE', note: 'A value nobody ever stated.' },
  { id: 's08', kind: 'judge', caption: 'TWO HOPS', note: 'The answer is on a second entity.' },
  { id: 's09', kind: 'continuity' },
  { id: 's10', kind: 'shot', file: 'live-hydradb-1920x1080.png', caption: 'HYDRADB CLOUD' },
  { id: 's11', kind: 'bench' },
  { id: 's12', kind: 'parity' },
  { id: 's13', kind: 'close' },
];

let at = LEAD_IN;
const timed = scenes.map((scene) => {
  const duration = seconds[scene.id] + BREATH;
  const placed = { ...scene, start: Math.round(at * 100) / 100, duration: Math.round(duration * 100) / 100 };
  at += duration;
  return placed;
});

const TOTAL = Math.round((at + 0.6) * 100) / 100;

const esc = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function body(scene) {
  switch (scene.kind) {
    case 'open':
      return `
        <div class="stack center">
          <div id="${scene.id}-mark" class="mark"></div>
          <h1 id="${scene.id}-h" class="hero">Memory that knows<br class="allowed" />what changed.</h1>
          <p id="${scene.id}-k" class="kicker">CONTEXT FOR LONG RUNNING AGENTS</p>
        </div>`;
    case 'problem':
      return `
        <div class="stack left">
          <p class="kicker">ONE QUESTION, FOUR ANSWERS STILL IN MEMORY</p>
          <ul class="sources">
            <li id="${scene.id}-a"><span class="src">README</span><span class="val">Redis</span><span class="tag">STALE</span></li>
            <li id="${scene.id}-b"><span class="src">Slack thread</span><span class="val">Postgres?</span><span class="tag">PROPOSAL</span></li>
            <li id="${scene.id}-c"><span class="src">Pull request</span><span class="val">Postgres</span><span class="tag amber">IMPLEMENTED</span></li>
            <li id="${scene.id}-d"><span class="src">Runbook</span><span class="val">Postgres</span><span class="tag amber">CONFIRMED</span></li>
          </ul>
          <p id="${scene.id}-q" class="line">Where does session state live now?</p>
        </div>`;
    case 'project':
      return `
        <div class="stack left">
          <p class="kicker">LACUNA · BUILT ON HYDRADB</p>
          <div class="pipe">
            <span id="${scene.id}-1" class="node">CONVERSATIONS</span>
            <span id="${scene.id}-2" class="arrow">→</span>
            <span id="${scene.id}-3" class="node">CLAIMS · TIME · SOURCE</span>
            <span id="${scene.id}-4" class="arrow">→</span>
            <span id="${scene.id}-5" class="node violet">ANSWER · EVIDENCE</span>
          </div>
          <p id="${scene.id}-l" class="line">Answers come from the claims, not from the text.</p>
        </div>`;
    case 'judge':
      return `
        <img id="${scene.id}-img" class="pan" data-layout-allow-overflow="true" src="assets/screens/live-judge-fullpage.png" alt="" />
        <div class="band"></div>
        <div id="${scene.id}-cap" class="caption">
          <span class="kicker violet">${esc(scene.caption)}</span>
          <span class="note">${esc(scene.note)}</span>
        </div>`;
    case 'shot':
      return `
        <img id="${scene.id}-img" class="full" data-layout-allow-overflow="true" src="assets/screens/${scene.file}" alt="" />
        <div class="band"></div>
        <div id="${scene.id}-cap" class="caption">
          <span class="kicker violet">${esc(scene.caption)}</span>
          <span class="note">72 conversations as evidence · 86 entity records as claims</span>
        </div>`;
    case 'continuity':
      return `
        <div class="stack left">
          <p class="kicker">npm run continuity · artifacts/continuity/one-context.json</p>
          <div class="terminal">
${CONTINUITY.map((line, index) => `            <div id="${scene.id}-l${index}" class="tline${/ONE_CONTEXT_IDENTICAL/.test(line) ? ' win' : ''}${/^ok/.test(line) ? ' ok' : ''}">${esc(line) || '&nbsp;'}</div>`).join(String.fromCharCode(10))}
          </div>
        </div>`;
    case 'bench':
      return `
        <div class="stack left">
          <p class="kicker">64 GOLD QUESTIONS · FIVE RETRIEVAL BASELINES · artifacts/bench/results.json</p>
          <table class="bench">
            <tr id="${scene.id}-r1"><td>recency</td><td class="num">46</td><td class="num dim">1029 tokens</td></tr>
            <tr id="${scene.id}-r2"><td>vector</td><td class="num">47</td><td class="num dim">1311 tokens</td></tr>
            <tr id="${scene.id}-r3"><td>lexical</td><td class="num">48</td><td class="num dim">516 tokens</td></tr>
            <tr id="${scene.id}-r4"><td>hybrid</td><td class="num">48</td><td class="num dim">529 tokens</td></tr>
            <tr id="${scene.id}-r5"><td>hybrid + 2 hop</td><td class="num">63</td><td class="num dim">1843 tokens</td></tr>
            <tr id="${scene.id}-r6" class="win"><td>Lacuna</td><td class="num">64</td><td class="num">18 tokens</td></tr>
          </table>
        </div>`;
    case 'parity':
      return `
        <div class="stack center">
          <p class="kicker">SELF HOSTED NODE VERSUS HYDRADB CLOUD</p>
          <h2 id="${scene.id}-h" class="big">ALL_IDENTICAL: true</h2>
          <p id="${scene.id}-l" class="line">64 questions, compared field by field. artifacts/hydra/cloud-parity.json</p>
        </div>`;
    case 'close':
      return `
        <div class="stack center">
          <div id="${scene.id}-mark" class="mark"></div>
          <h2 id="${scene.id}-h" class="big">One context. Any agent.</h2>
          <p id="${scene.id}-u" class="url">lacuna-five.vercel.app/judge</p>
          <p id="${scene.id}-r" class="kicker">github.com/vaibhav4046/lacuna</p>
        </div>`;
    default:
      return '';
  }
}

const clips = timed.map((scene) => `      <section id="${scene.id}" class="clip scene ${scene.kind}" data-start="${scene.start}" data-duration="${scene.duration}" data-track-index="1">${body(scene)}
      </section>`).join('\n');

const audio = timed.map((scene) => `      <audio id="${scene.id}-vo" src="assets/narration/${scene.id}.mp3" data-start="${scene.start}" data-duration="${seconds[scene.id]}" data-track-index="2"></audio>`).join('\n');

/** One entrance per scene, written as data so the timeline stays readable. */
const moves = timed.map((scene) => {
  const t = scene.start;
  const common = `tl.fromTo("#${scene.id}", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power2.out" }, ${t});`;
  switch (scene.kind) {
    case 'open':
      return `${common}
  tl.fromTo("#${scene.id}-mark", { scale: 0.7, opacity: 0 }, { scale: 1, opacity: 1, duration: 1.1, ease: "power3.out" }, ${t + 0.1});
  tl.fromTo("#${scene.id}-h", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 1, ease: "power3.out" }, ${t + 0.5});
  tl.fromTo("#${scene.id}-k", { opacity: 0 }, { opacity: 1, duration: 0.8 }, ${t + 1.4});`;
    case 'problem':
      return `${common}
  ${['a', 'b', 'c', 'd'].map((key, index) => `tl.fromTo("#${scene.id}-${key}", { x: -34, opacity: 0 }, { x: 0, opacity: 1, duration: 0.6, ease: "power3.out" }, ${t + 0.6 + index * 1.5});`).join('\n  ')}
  tl.fromTo("#${scene.id}-q", { opacity: 0 }, { opacity: 1, duration: 0.8 }, ${t + 7.4});`;
    case 'project':
      return `${common}
  ${[1, 2, 3, 4, 5].map((n, index) => `tl.fromTo("#${scene.id}-${n}", { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, ${t + 0.7 + index * 0.7});`).join('\n  ')}
  tl.fromTo("#${scene.id}-l", { opacity: 0 }, { opacity: 1, duration: 0.8 }, ${t + 5.2});`;
    case 'judge':
      return `${common}
  tl.fromTo("#${scene.id}-img", { x: ${PAN[scene.id].x}, y: ${PAN[scene.id].y - 22} }, { x: ${PAN[scene.id].x}, y: ${PAN[scene.id].y + 8}, duration: ${scene.duration}, ease: "none" }, ${t});
  tl.fromTo("#${scene.id}-cap", { x: -26, opacity: 0 }, { x: 0, opacity: 1, duration: 0.7, ease: "power3.out" }, ${t + 0.3});`;
    case 'shot':
      return `${common}
  tl.fromTo("#${scene.id}-img", { x: -637, y: -60 }, { x: -663, y: -74, duration: ${scene.duration}, ease: "none" }, ${t});
  tl.fromTo("#${scene.id}-cap", { x: -26, opacity: 0 }, { x: 0, opacity: 1, duration: 0.7, ease: "power3.out" }, ${t + 0.3});`;
    case 'continuity':
      return `${common}
  ${CONTINUITY.map((_, index) => `tl.fromTo("#${scene.id}-l${index}", { opacity: 0 }, { opacity: 1, duration: 0.35, ease: "none" }, ${(t + 0.6 + index * 0.62).toFixed(2)});`).join(String.fromCharCode(10))}`;
    case 'bench':
      return `${common}
  ${[1, 2, 3, 4, 5, 6].map((n, index) => `tl.fromTo("#${scene.id}-r${n}", { x: -20, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, ${t + 0.9 + index * 1.35});`).join('\n  ')}`;
    case 'parity':
      return `${common}
  tl.fromTo("#${scene.id}-h", { y: 26, opacity: 0 }, { y: 0, opacity: 1, duration: 0.9, ease: "power3.out" }, ${t + 0.4});
  tl.fromTo("#${scene.id}-l", { opacity: 0 }, { opacity: 1, duration: 0.8 }, ${t + 2.2});`;
    case 'close':
      return `${common}
  tl.fromTo("#${scene.id}-mark", { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 1, ease: "power3.out" }, ${t + 0.1});
  tl.fromTo("#${scene.id}-h", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.9, ease: "power3.out" }, ${t + 0.6});
  tl.fromTo("#${scene.id}-u", { opacity: 0 }, { opacity: 1, duration: 0.8 }, ${t + 1.6});
  tl.fromTo("#${scene.id}-r", { opacity: 0 }, { opacity: 1, duration: 0.8 }, ${t + 2.4});`;
    default:
      return common;
  }
}).join('\n  ');

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>Lacuna — memory that knows what changed</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      @font-face {
        font-family: 'Space Grotesk';
        src: url('assets/fonts/space-grotesk-latin.woff2') format('woff2');
        font-weight: 300 700;
        font-display: block;
      }
      @font-face {
        font-family: 'JetBrains Mono';
        src: url('assets/fonts/jetbrains-mono-latin.woff2') format('woff2');
        font-weight: 400 500;
        font-display: block;
      }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1920px; height: 1080px; overflow: hidden; background: #000000; }
      body { font-family: 'Space Grotesk', system-ui, sans-serif; color: #FFFFFF; }
      #root { position: relative; width: 1920px; height: 1080px; overflow: hidden; }
      .ground { position: absolute; inset: 0; background: #000000; }
      .scene { position: absolute; inset: 0; overflow: hidden; }
      .stack { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; gap: 30px; padding: 0 150px; }
      .stack.center { align-items: center; text-align: center; }
      .stack.left { align-items: flex-start; }
      .hero { font-size: 104px; font-weight: 300; line-height: 1.08; letter-spacing: -0.03em; }
      .big { font-size: 76px; font-weight: 300; letter-spacing: -0.02em; }
      .line { font-size: 34px; font-weight: 300; color: #BDBDBD; }
      .url { font-family: 'JetBrains Mono', monospace; font-size: 34px; color: #8052FF; letter-spacing: 0.02em; }
      .kicker { font-family: 'JetBrains Mono', monospace; font-size: 17px; letter-spacing: 0.24em; color: #757575; }
      .kicker.violet { color: #8052FF; }
      .mark { width: 96px; height: 96px; border-radius: 50%; border: 2px solid #8052FF; border-right-color: transparent; }
      .sources { list-style: none; display: flex; flex-direction: column; gap: 22px; width: 100%; max-width: 1300px; }
      .sources li { display: flex; align-items: baseline; gap: 30px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 16px; }
      .src { font-size: 34px; color: #BDBDBD; width: 300px; }
      .val { font-size: 40px; font-weight: 300; flex: 1; }
      .tag { font-family: 'JetBrains Mono', monospace; font-size: 15px; letter-spacing: 0.2em; color: #8C8C8C; }
      .tag.amber { color: #FFB829; }
      .pipe { display: flex; align-items: center; gap: 26px; flex-wrap: wrap; }
      .node { font-family: 'JetBrains Mono', monospace; font-size: 21px; letter-spacing: 0.16em; color: #BDBDBD; border: 1px solid rgba(255,255,255,0.16); border-radius: 8px; padding: 18px 26px; }
      .node.violet { color: #FFFFFF; border-color: #8052FF; }
      .arrow { color: #757575; font-size: 30px; }
      .terminal { font-family: 'JetBrains Mono', monospace; font-size: 21px; line-height: 1.85; color: #BDBDBD; border-left: 2px solid rgba(128,82,255,0.5); padding-left: 28px; }
      /* The whitespace belongs on the line, not the block: pre on the container renders the template's own newlines as blank lines. */
      .tline { white-space: pre; min-height: 1.2em; }
      .tline.ok { color: #FFFFFF; }
      .tline.win { color: #8052FF; font-size: 27px; padding-top: 16px; }
      .bench { border-collapse: collapse; width: 100%; max-width: 1250px; }
      .bench td { font-size: 40px; font-weight: 300; padding: 20px 0; border-bottom: 1px solid rgba(255,255,255,0.1); color: #BDBDBD; }
      .bench .num { font-family: 'JetBrains Mono', monospace; font-size: 34px; text-align: right; width: 300px; color: #FFFFFF; }
      .bench .num.dim { color: #8C8C8C; }
      .bench .win td { color: #FFFFFF; border-bottom-color: #8052FF; }
      .bench .win .num { color: #8052FF; }
      .pan { position: absolute; top: 0; left: 0; width: ${JUDGE_W}px; height: ${JUDGE_H}px; }
      .full { position: absolute; top: 0; left: 0; width: 2880px; height: 1620px; }
      .band { position: absolute; left: 0; right: 0; bottom: 0; height: 250px; background: #000000; border-top: 1px solid rgba(128,82,255,0.5); }
      .caption { position: absolute; left: 120px; bottom: 74px; display: flex; flex-direction: column; gap: 16px; max-width: 1100px; }
      .caption .note { font-size: 40px; font-weight: 300; color: #FFFFFF; line-height: 1.2; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="lacuna" data-start="0" data-width="1920" data-height="1080" data-duration="${TOTAL}" data-fps="30">
      <div class="ground"></div>
${clips}
${audio}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
  ${moves}
      window.__timelines["lacuna"] = tl;
    </script>
  </body>
</html>
`;

writeFileSync(`${ROOT}index.html`, html);
writeFileSync(`${ROOT}meta.json`, `${JSON.stringify({
  title: 'Lacuna — memory that knows what changed',
  durationSeconds: TOTAL,
  scenes: timed.map((scene) => ({ id: scene.id, kind: scene.kind, start: scene.start, duration: scene.duration })),
}, null, 2)}\n`);

process.stdout.write(`index.html written · ${timed.length} scenes · ${TOTAL}s\n`);
for (const scene of timed) {
  process.stdout.write(`  ${scene.id}  ${String(scene.start).padStart(7)}s  +${scene.duration}s  ${scene.kind}\n`);
}
