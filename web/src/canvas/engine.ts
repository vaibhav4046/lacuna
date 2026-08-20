// @ts-nocheck
/**
 * The Memory Gravity Field, ported from the design's logic class.
 *
 * Everything below the field declarations is the design's own code, extracted
 * rather than retyped: `mountImpl` through `drawHealth`, in order, with the
 * class scaffolding around it changed and nothing else. The three lifecycle
 * methods keep their bodies and lose their React names, because a React class
 * is not what this is any more, and `this.state` and `this.props` are now
 * plain objects the component writes into.
 *
 * The file is not type checked, deliberately. This is six hundred lines of
 * numeric canvas code whose correctness is defined by the design, and under
 * `noUncheckedIndexedAccess` every `pts[i][0]` in it needs an assertion that
 * changes the source. A verbatim port that has been edited to satisfy a type
 * checker is not a verbatim port. The boundary is typed instead: the component
 * that owns this holds a `MemoryFieldEngine` and calls three methods on it.
 *
 * What it preserves, because these are the behaviours the design specifies:
 * one persistent field; per scene deterministic morph targets; a one shot
 * scroll where `_vis` pins the maximum progress each scene has reached, so
 * scrolling up shows the resolved state and never reverses; a text shield that
 * collapses particle alpha inside the bounding boxes of live headings; pointer
 * gravity; hover hotspots with canvas labels; click focus, including the gap
 * that answers "Nothing supported this claim."; a reduced motion branch;
 * device pixel ratio capped at 1.8; adaptive particle counts; suspension when
 * the document is hidden; and a primed first frame so the canvas is never
 * blank.
 */

export interface EngineState {
  view: 'landing' | 'signin' | 'signup' | 'forgot' | 'onboard' | 'app';
  route: string;
  obStep: number;
  healthSel: number;
  hoverRev: number;
}

export interface EngineProps {
  density?: 'auto' | 'high' | 'balanced' | 'low';
  motion?: 'auto' | 'full' | 'reduced';
}

export interface CanvasRef {
  current: HTMLCanvasElement | null;
}

/**
 * The surface the component is allowed to touch. Declaration merging, because
 * the implementation below is not type checked and its constructor assigned
 * fields are therefore invisible to callers. Everything else on the class is
 * the engine's own business.
 */
export interface MemoryFieldEngine {
  state: EngineState;
  props: EngineProps;
  mount(): void;
  unmount(): void;
  changed(previousProps: EngineProps, previousState: { view: EngineState['view'] }): void;
}

export class MemoryFieldEngine {
  constructor(canvasRef, options = {}) {
    this.canvasRef = canvasRef;
    this.healthRef = options.healthRef ?? { current: null };
    this.voiceRef = options.voiceRef ?? { current: null };
    this.props = options.props ?? {};
    this.state = options.state ?? { view: 'landing', route: 'dash', obStep: 0, healthSel: -1, hoverRev: -1 };

    // Everything the design sets on the instance, declared in one place so a
    // reader does not have to find the assignment that creates each one.
    this.P = [];
    this.W = 0; this.H = 0; this.dpr = 1; this.sized = 0;
    this.mx = -9999; this.my = -9999;
    this.rm = false;
    this.raf = 0; this.wd = null;
    this.focus = null;
    this._vis = {}; this._scenes = null; this._hn = null; this._hot = null;
    this._rk = null; this._q = null; this._sc = null; this._shield = null;
    this._shieldT = 0; this._prime = false; this._lastTick = 0; this._loopErr = 0;
    this._seed = 0x4c414355;
  }
  HEALTH = [
    { l: 'Historical', n: 214, col: '#6E6E6E' },
    { l: 'Derived memory', n: 21, col: '#4A4A4A' },
    { l: 'Duplicates', n: 12, col: '#9A9A9A' },
    { l: 'Stale summaries', n: 9, col: '#3F3F46' },
    { l: 'Scope issues', n: 4, col: '#8A8A8A' },
    { l: 'Conflicts', n: 2, col: '#FFB829' },
    { l: 'Weak evidence', n: 17, col: '#15846E' },
    { l: 'Current', n: 96, col: '#8052FF' }
  ];
  CLPOS = [[0.16, 0.36], [0.84, 0.33], [0.13, 0.70], [0.87, 0.68], [0.50, 0.84]];

  mount() {
    // The design read a startView prop here and pushed it into its own state.
    // React owns the view now and writes it into this.state directly, so there
    // is nothing for the engine to decide.
    const mo = this.props.motion || 'auto';
    this.rm = mo === 'reduced' ? true : mo === 'full' ? false : !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.mx = -9999; this.my = -9999; this._vis = {};
    this.initParticles();
    this.onResize = () => { this.sized = 0; this._hn = null; this._scenes = null; this._rk = null; };
    this.onMove = (e) => { this.mx = e.clientX; this.my = e.clientY; };
    this.onClick = (e) => this.handleClick(e);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('pointermove', this.onMove, { passive: true });
    window.addEventListener('click', this.onClick);
    this.raf = requestAnimationFrame((t) => this.loop(t));
    this.drawHealth();
    this.drawVoice();
    this._prime = true;
    this.loop(performance.now());
    this.wd = setInterval(() => { if (performance.now() - (this._lastTick || 0) > 700) this.loop(performance.now()); }, 750);
  }
  unmount() {
    cancelAnimationFrame(this.raf);
    clearInterval(this.wd);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('click', this.onClick);
  }
  changed(pp, ps) {
    if (ps.view !== this.state.view) { this._scenes = null; this._q = null; this._rk = null; }
    if (ps.view !== this.state.view || ps.route !== this.state.route || ps.healthSel !== this.state.healthSel) { this.drawHealth(); this.drawVoice(); }
  }
  random() {
    this._seed = (Math.imul(this._seed, 1664525) + 1013904223) >>> 0;
    return this._seed / 4294967296;
  }
  initParticles() {
    const W = innerWidth;
    const d = this.props.density || 'auto';
    let n = d === 'high' ? 1900 : d === 'balanced' ? 1200 : d === 'low' ? 650 : (W < 760 ? 520 : W < 1200 ? 1050 : 1500);
    this.P = [];
    // A fixed viewport produces a fixed field. That makes screenshots and the
    // launch film repeatable while preserving the same distribution and motion.
    this._seed = (0x4c414355 ^ W ^ n) >>> 0;
    const grey = ['#EDEDED', '#B9B9B9', '#8A8A8A', '#7A7A7A'];
    for (let i = 0; i < n; i++) {
      const cr = this.random();
      let col, amber = false;
      if (cr < 0.90) col = grey[(this.random() * 4) | 0];
      else if (cr < 0.955) col = '#8052FF';
      else if (cr < 0.99) { col = '#FFB829'; amber = true; }
      else col = '#15846E';
      const ph = this.random() * 6.283;
      this.P.push({
        x: this.random() * W, y: this.random() * innerHeight, tx: 0, ty: 0, ta: 0, ca: 0, tsz: 1,
        k: (this.random() * 21) | 0, col, amber, z: 0.35 + this.random() * 0.65, s: 0.7 + this.random() * 1.6,
        r1: this.random(), r2: this.random(), r3: this.random(), r4: this.random(), ph,
        lc: Math.cos(ph), ls: Math.sin(ph)
      });
    }
  }
  SP(t) {
    const L1 = 26.389, L2 = 18.850, L3 = 11.624, T = 56.863;
    const u = Math.max(0, Math.min(1, t)) * T;
    let x, y;
    if (u < L1) { const a = -Math.PI / 2 + Math.PI * (u / L1); x = 12 + 8.4 * Math.cos(a); y = 11 + 8.4 * Math.sin(a); }
    else if (u < L1 + L2) { const a = Math.PI / 2 + Math.PI * ((u - L1) / L2); x = 12 + 6 * Math.cos(a); y = 13.4 + 6 * Math.sin(a); }
    else { const a = -Math.PI / 2 + Math.PI * ((u - L1 - L2) / L3); x = 12 + 3.7 * Math.cos(a); y = 11.1 + 3.7 * Math.sin(a); }
    return { x: (x - 12) / 8.4, y: (y - 11.3) / 8.4 };
  }
  ez(v) { v = Math.max(0, Math.min(1, v)); return v * v * (3 - 2 * v); }
  cl(v) { return Math.max(0, Math.min(1, v)); }
  textRects() {
    const out = [], vh = innerHeight, vw = innerWidth;
    const els = document.querySelectorAll('h1, h2, [data-scene] p, [data-scene] pre, [data-scene] [data-fx], [data-navlinks], [data-shield]');
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (r.width < 30 || r.height < 8) continue;
      if (r.bottom < -20 || r.top > vh + 20 || r.right < -20 || r.left > vw + 20) continue;
      out.push([r.left - 10, r.top - 6, r.right + 10, r.bottom + 6]);
    }
    return out;
  }
  detectScene() {
    if (!this._scenes) this._scenes = Array.prototype.slice.call(document.querySelectorAll('[data-scene]'));
    const vh = innerHeight;
    let best = null, bo = -1e9;
    for (let i = 0; i < this._scenes.length; i++) {
      const r = this._scenes[i].getBoundingClientRect();
      if (r.height < 10) continue;
      const ov = Math.min(r.bottom, vh) - Math.max(r.top, 0);
      if (ov > bo) { bo = ov; best = { el: this._scenes[i], r }; }
    }
    if (!best) return ['hero', 0.3];
    const r = best.r;
    let pr = r.height > vh * 1.2 ? (-r.top) / Math.max(1, r.height - vh) : (vh - r.top) / (vh + r.height);
    return [best.el.getAttribute('data-scene'), this.cl(pr)];
  }
  hydraNodes(W, H, mode) {
    if (!this._hn) this._hn = {};
    if (this._hn[mode]) return this._hn[mode];
    const arch = mode === 'arch';
    const bx = arch ? (W < 1100 ? 0.56 : 0.60) : 0.52;
    const by = arch ? (W < 1100 ? 0.64 : 0.56) : 0.53;
    const sy = arch ? (W < 760 ? 0.09 : 0.11) : 0.10;
    const pts = [], edges = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
      if (Math.sin(r * 37.7 + c * 17.3) < -0.62) continue;
      pts.push([W * bx + (c - 2.5) * W * 0.08 + (r % 2 ? W * 0.035 : 0), H * by + (r - 1.5) * H * sy]);
    }
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i][0] - pts[j][0], dy = pts[i][1] - pts[j][1];
      if (Math.sqrt(dx * dx + dy * dy) < W * 0.12 && Math.sin(i * 13.1 + j * 7.7) > 0.1) edges.push([i, j]);
    }
    this._hn[mode] = { pts, edges };
    return this._hn[mode];
  }
  hotspots(sc, W, H, m) {
    const S = [];
    if (sc === 'real') {
      const AXh = W < 900 ? 0.74 : 0.60, AYh = W < 900 ? 0.26 : 0.55;
      const N = [[0.58, 0.26, 'README · REDIS'], [0.82, 0.24, 'SLACK · PROPOSAL'], [0.50, 0.66, 'PR #184 · POSTGRES'], [0.82, 0.84, 'RUNBOOK · POSTGRES'], [AXh, AYh, 'CURRENT']];
      N.forEach((n, i) => S.push({ x: W * n[0], y: H * n[1], r: m * 0.07, id: 'real' + i, label: n[2] }));
    } else if (sc === 'rot') {
      const R = [[0.38, 0.38, 'DUPLICATE'], [0.66, 0.32, 'HISTORICAL'], [0.62, 0.72, 'CONFLICT'], [0.34, 0.70, 'WEAK SUPPORT']];
      R.forEach((n, i) => S.push({ x: W * n[0], y: H * n[1], r: m * 0.09, id: 'rot' + i, label: n[2] }));
    } else if (sc === 'funnel') {
      const cx = W * (W < 760 ? 0.44 : 0.62), Y = [0.14, 0.29, 0.44, 0.58, 0.72, 0.86];
      const L = ['RAW CONTEXT · 256', 'SCOPE · 96', 'RETRIEVAL · 31', 'GRAPH · 12', 'CURRENT · EVIDENCE · 6', 'CONTEXT PACK · 1'];
      Y.forEach((y, i) => S.push({ x: cx, y: H * y, r: m * 0.075, id: 'fun' + i, label: L[i] }));
    } else if (sc === 'arch') {
      S.push({ x: W * 0.11, y: H * 0.50, r: m * 0.12, id: 'arch0', label: 'SOURCES · INGESTION' });
      const ax2 = W * (W < 1100 ? 0.56 : 0.60), ay2 = H * (W < 1100 ? 0.64 : 0.56);
      S.push({ x: ax2, y: ay2, r: m * 0.13, id: 'arch1', label: 'HYDRADB · PERSISTENT GRAPH STATE' });
      S.push({ x: ax2, y: ay2 - m * 0.19, r: m * 0.07, id: 'arch2', label: 'LACUNA CONTEXT OS' });
      S.push({ x: W * 0.86, y: H * 0.50, r: m * 0.07, id: 'arch3', label: 'CONTEXT PACK' });
    } else if (sc === 'any') {
      this.CLPOS.forEach((A, i) => S.push({ x: W * A[0], y: H * A[1], r: m * 0.06, id: 'any' + i, label: ['CLAUDE', 'CODEX', 'LOCAL', 'VOICE', 'CUSTOM'][i] + ' · SAME PACK' }));
      S.push({ x: W * 0.5, y: H * 0.57, r: m * 0.05, id: 'anyP', label: 'ONE PACK · NO COPIES' });
    } else if (sc === 'pack') {
      const k = 1;
      S.push({ x: W * 0.58, y: H * 0.55, r: m * 0.07, id: 'packP', label: 'CLICK · OPEN THE PACK' });
    } else if (sc === 'gap' || sc === 'void') {
      S.push({ x: W * 0.5, y: H * 0.55, r: m * 0.11, id: 'gapC', label: 'THE GAP · NOTHING SUPPORTED THIS CLAIM' });
    } else if (sc === 'temporal') {
      const tx = W * (W < 900 ? 0.5 : 0.70), ty = H * 0.55;
      S.push({ x: tx, y: ty - m * 0.115 * 0.88, r: m * 0.05, id: 'tem0', label: 'POSTGRES · CURRENT' });
      S.push({ x: tx, y: ty - m * 0.185 * 0.88, r: m * 0.04, id: 'tem1', label: 'PROPOSAL · NEVER CURRENT' });
      S.push({ x: tx, y: ty - m * 0.255 * 0.88, r: m * 0.04, id: 'tem2', label: 'REDIS · HISTORICAL' });
    } else if (sc === 'hydra') {
      S.push({ x: W * 0.52, y: H * 0.56, r: m * 0.16, id: 'hyG', label: 'GRAPH · RELATIONSHIPS MADE EXPLICIT' });
    }
    return S;
  }
  handleClick(e) {
    if (this.state.view !== 'landing') return;
    if (e.target && e.target.closest && e.target.closest('a,button,input,textarea,select,label')) return;
    const sc = this._sc, W = innerWidth, H = innerHeight, m = Math.min(W, H);
    if (!sc) return;
    const hs = this.hotspots(sc, W, H, m);
    for (let i = 0; i < hs.length; i++) {
      const dx = e.clientX - hs[i].x, dy = e.clientY - hs[i].y;
      if (dx * dx + dy * dy < hs[i].r * hs[i].r * 2.2) {
        this.focus = { sc, id: hs[i].id, label: hs[i].id === 'gapC' ? 'NOTHING SUPPORTED THIS CLAIM.' : hs[i].label, x: hs[i].x, y: hs[i].y, until: performance.now() + 3400 };
        return;
      }
    }
  }
  computeTarget(p, i, d) {
    const { sc, pr, tm, W, H, m } = d;
    const g1 = (p.r2 + p.r3 - 1), g2 = (p.r3 + p.r4 - 1);
    let x = p.r2 * W, y = p.r3 * H, a = 0.2, sz = 1;
    if (sc === 'hero' || sc === 'auth' || sc === 'onboard' || sc === 'core' || sc === 'final') {
      const wide = W >= 1280, mid = W >= 900;
      let S = m * (wide ? 0.40 : mid ? 0.33 : 0.30) * (1 + pr * 0.35);
      let hx = W * (wide ? 0.70 : mid ? 0.78 : 0.5), hy = H * (mid ? 0.52 : 0.70), j = 0.105, out = 0.22, base = 0.9;
      if (sc === 'auth') { S = m * 0.17; hx = W * (W < 900 ? 0.5 : 0.30); hy = H * (W < 900 ? 0.22 : 0.46); j = 0.05; out = 0.10; base = 0.42; }
      if (sc === 'onboard') { S = m * 0.15; hx = W * (W < 900 ? 0.5 : 0.86); hy = H * (W < 900 ? 0.16 : 0.76); j = 0.05; out = 0.08; base = 0.45; }
      if (sc === 'core') { S = m * 0.19; hx = W * (W < 1100 ? 0.80 : 0.74); hy = H * 0.55; j = 0.09; out = 0.16; base = 0.8; }
      if (sc === 'final') { const k = this.ez(Math.min(1, pr * 1.5)); S = m * 0.30; hx = W * 0.5; hy = H * 0.64; j = 0.13 * (1 - k) + 0.016; out = 0.06 * (1 - k) + 0.02; base = 0.55 + 0.45 * k; }
      const crawl = (p.r2 + tm * 0.0000045) % 1;
      if (p.amber) { const q0 = this.SP(0.004); x = hx + q0.x * S + (p.r2 - 0.5) * 12; y = hy + q0.y * S + (p.r4 - 0.5) * 12; a = Math.min(1, base + 0.35); sz = 1.25; if (p.r3 > 0.7 && sc === 'hero') { const q = this.SP(crawl); x = hx + q.x * S; y = hy + q.y * S; } }
      else if (p.r1 < out) { x = hx + (p.r2 - 0.5) * S * 4.2; y = hy + (p.r3 - 0.5) * S * 3.2; a = 0.3; }
      else { const q = this.SP(sc === 'hero' ? crawl : p.r2); x = hx + q.x * S + g1 * S * j; y = hy + q.y * S + g2 * S * j; a = base; }
      if (sc === 'onboard') { const lim = (this.state.obStep + 1) / 5; if (p.r2 > lim && !p.amber) a = 0.05; }
    } else if (sc === 'real') {
      const N = [[0.58, 0.26], [0.82, 0.24], [0.50, 0.66], [0.82, 0.84]], ANS = W < 900 ? [0.74, 0.26] : [0.60, 0.55], th = [0.05, 0.11, 0.17, 0.23];
      if (p.amber) { x = W * ANS[0] + Math.cos(tm * 0.001 + p.ph) * 14; y = H * ANS[1] + Math.sin(tm * 0.001 + p.ph) * 14; a = this.cl((pr - 0.34) * 6); sz = 1.2; }
      else if (p.r1 > 0.87) { const from = p.r4 < 0.5 ? N[2] : N[3]; const t = p.r2; x = W * (from[0] + (ANS[0] - from[0]) * t); y = H * (from[1] + (ANS[1] - from[1]) * t) + g1 * 5; a = this.cl((pr - 0.30) * 5) * 0.9; }
      else {
        const ci = i % 4, A = N[ci], R = m * 0.05;
        x = W * A[0] + g1 * R * 1.7; y = H * A[1] + g2 * R * 1.5;
        a = this.cl((pr - th[ci]) * 8);
        if (pr > 0.34) { if (ci === 0) { a *= 0.35; x += W * 0.03; y -= H * 0.05; } else if (ci === 1) a *= 0.3; }
      }
    } else if (sc === 'gap' || sc === 'void') {
      const gx = W * 0.5, gy = H * 0.55, rx = m * 0.21, ry = m * 0.105;
      const an = p.r2 * 6.283 + tm * 0.00004;
      if (p.r1 < 0.10) { const k = 1 + Math.abs(Math.sin(tm * 0.0005 + p.r4 * 6.28)) * 0.55; x = gx + Math.cos(an) * rx * k; y = gy + Math.sin(an) * ry * k; a = 0.9; }
      else { const rad = 1 + Math.pow(p.r3, 1.7) * 2.6; x = gx + Math.cos(an) * rx * rad; y = gy + Math.sin(an) * ry * rad; a = 0.85 / Math.pow(rad, 1.7); }
    } else if (sc === 'arch') {
      const cx = W * (W < 1100 ? 0.56 : 0.60), cy = H * (W < 1100 ? 0.64 : 0.56);
      if (p.r1 < 0.18) { const t = (tm * 0.00007 + p.r4) % 1, k = this.cl((pr - 0.05) * 4), sy = 0.22 + (i % 8) * 0.08; x = W * 0.11 + (cx - W * 0.11) * t; y = H * sy + (cy - H * sy) * t; a = k * (0.15 + 0.6 * t); }
      else if (p.r1 < 0.48) { const hn = this.hydraNodes(W, H, 'arch'), A = hn.pts[i % hn.pts.length]; x = A[0] + g1 * 5; y = A[1] + g2 * 5; a = this.cl((pr - 0.12) * 4) * 0.95; sz = 1.05; }
      else if (p.r1 < 0.70) { const an = p.r2 * 6.283 + tm * 0.00006; x = cx + Math.cos(an) * m * 0.28; y = cy + Math.sin(an) * m * 0.19; a = this.cl((pr - 0.32) * 4) * 0.5; }
      else if (p.r1 < 0.84) { x = W * 0.86 + g1 * 14; y = H * 0.50 + g2 * 13; a = this.cl((pr - 0.58) * 5); }
      else { const t = (tm * 0.00022 + p.r4) % 1; x = W * 0.86 + (cx + m * 0.1 - W * 0.86) * t; y = H * 0.50 + (cy - H * 0.50) * t - Math.sin(t * 3.14) * 30; a = this.cl((pr - 0.74) * 5) * 0.7 * t; }
    } else if (sc === 'funnel') {
      if (i >= 256) { a = 0; }
      else {
        const cx = W * (W < 760 ? 0.44 : 0.62), Y = [0.14, 0.29, 0.44, 0.58, 0.72, 0.86], HW = [0.16, 0.115, 0.082, 0.055, 0.032, 0.008], lim = [256, 96, 31, 12, 6, 1];
        let E = 6;
        for (let s2 = 1; s2 < 6; s2++) { if (i >= lim[s2]) { E = s2; break; } }
        const fs = Math.min(5, Math.floor(this.cl((pr - 0.06) / 0.78) * 6));
        if (E !== 6 && fs >= E) { const side = p.r2 < 0.5 ? -1 : 1; x = cx + side * (HW[E] * W + 40 + p.r3 * 80); y = H * Y[E] + g2 * 22; a = 0.15; }
        else { const stg = E === 6 ? fs : Math.min(fs, E - 1); x = cx + (p.r2 - 0.5) * 2 * HW[stg] * W; y = H * (Y[stg] + (p.r3 - 0.5) * 0.05); a = i < 6 ? 1 : 0.8; if (i < 1) { sz = 1.6; a = 1; } }
      }
    } else if (sc === 'rot' || sc === 'org') {
      const n = sc === 'rot' ? this.ez(pr * 1.3) : 1 - this.ez(pr * 1.3);
      const S = m * (W < 1100 ? 0.26 : 0.32);
      const hx = W * (sc === 'rot' ? (W < 1100 ? 0.74 : 0.70) : (W < 1100 ? 0.26 : 0.30)), hy = H * (W < 900 ? 0.74 : 0.55);
      if (sc === 'org' && p.r1 >= 0.86 && p.r1 < 0.90) { const q0 = this.SP(0.30), bt = p.r3, dir = p.r4 < 0.5 ? 1 : -1; x = hx + q0.x * S + bt * S * 0.36; y = hy + q0.y * S + dir * bt * S * 0.22; a = 0.85; }
      else if (p.r1 > 0.90) { x = hx + (p.r2 - 0.5) * S * (2.2 + 3.6 * n); y = hy + (p.r3 - 0.5) * S * (1.8 + 2.8 * n); a = 0.35; }
      else {
        let t = p.r2;
        if (p.r1 < 0.14) t = Math.round(t * 26) / 26;
        const q = this.SP(t), jb = 0.055 + 0.17 * n;
        x = hx + q.x * S + g1 * S * jb + Math.sin(p.ph * 9 + t * 40) * n * S * 0.17;
        y = hy + q.y * S + g2 * S * jb + Math.cos(p.ph * 7 + t * 31) * n * S * 0.17;
        a = 0.9 - 0.25 * n;
      }
    } else if (sc === 'temporal') {
      const tx = W * (W < 900 ? 0.5 : 0.70), ty = H * 0.55, ring = i % 3;
      const RR = [m * 0.115, m * 0.185, m * 0.255][ring];
      const an = p.r2 * 6.283 + tm * [0.00016, -0.0001, 0.00006][ring];
      x = tx + Math.cos(an) * RR * 1.3; y = ty + Math.sin(an) * RR * 0.88;
      let base = [1, 0.4, 0.32][ring];
      if (ring === 1 && p.r1 > 0.4) base = 0;
      const hov = d.st.hoverRev;
      if (hov >= 0) base = (2 - hov) === ring ? 1.1 : base * 0.3;
      a = base;
      if (p.amber && ring === 0) { sz = 1.3; a = Math.min(1.2, base + 0.3); }
    } else if (sc === 'contra') {
      const y0 = H * 0.60, x0 = W * 0.14, xs = W * 0.50, xe = W * 0.86;
      const L = this.ez(this.cl((pr - 0.22) * 2.2));
      if (p.r3 < 0.55) { const t = p.r2; x = x0 + (xs - x0) * t; y = y0 + g1 * 7; a = 0.9; }
      else { const up = p.r4 < 0.5, t = p.r2 * L; x = xs + (xe - xs) * t; y = y0 + (up ? -1 : 1) * H * 0.15 * t + g1 * 7; a = 0.9; }
    } else if (sc === 'pack') {
      const k = this.ez(this.cl((pr - 0.08) / 0.6)), slide = this.ez(this.cl((pr - 0.8) * 5));
      const px = W * 0.44 + slide * W * 0.14, py = H * 0.55;
      const R = m * 0.36 * (1 - k) + 16 * k;
      const SRC = [[0.15, 0.30], [0.20, 0.80], [0.80, 0.26], [0.86, 0.72]];
      const fo = this.focus && this.focus.id === 'packP' && performance.now() < this.focus.until;
      if (p.r1 < 0.05) { const A = SRC[i % 4]; x = W * A[0] + g1 * 11; y = H * A[1] + g2 * 11; a = 0.85; }
      else if (fo) { const OF = [[-0.09, -0.07], [0.09, -0.07], [-0.09, 0.07], [0.09, 0.07]], A = OF[i % 4]; x = px + A[0] * m + g1 * 24; y = py + A[1] * m + g2 * 20; a = 0.9; }
      else { x = px + g1 * R; y = py + g2 * R * 0.85; a = 0.35 + 0.65 * k; }
    } else if (sc === 'speed') {
      if (p.r1 < 0.70) { x = W * 0.30 + g1 * m * 0.30; y = H * 0.55 + g2 * m * 0.26; a = 0.5; }
      else if (p.r1 < 0.86) { x = W * 0.72 + g1 * 13; y = H * 0.55 + g2 * 12; a = 1; }
      else { const t = (tm * 0.0003 + p.r4) % 1; x = W * 0.30 + m * 0.30 + (W * 0.72 - W * 0.30 - m * 0.30 - 20) * t; y = H * 0.55 + g1 * 6; a = 0.5; }
    } else if (sc === 'any') {
      const cx = W * 0.5, cy = H * 0.57, act = Math.floor(tm / 1900) % 5;
      if (p.r1 < 0.5) { x = cx + g1 * 21; y = cy + g2 * 19; a = 1; }
      else if (p.r1 < 0.80) { const jj = i % 5, A = this.CLPOS[jj]; x = W * A[0] + g1 * 27; y = H * A[1] + g2 * 23; a = jj === act ? 0.9 : 0.35; }
      else { const A = this.CLPOS[act], t = (tm * 0.00045 + p.r4) % 1; x = W * A[0] + (cx - W * A[0]) * t + g1 * 9; y = H * A[1] + (cy - H * A[1]) * t + g2 * 9; a = t * 0.9; }
    } else if (sc === 'harness') {
      const cx = W * (W < 900 ? 0.5 : 0.62), cy = H * (W < 900 ? 0.74 : 0.56);
      if (p.r1 < 0.5) { const q = this.SP(p.r2); const S = m * 0.09; x = cx + q.x * S + g1 * S * 0.12; y = cy + q.y * S + g2 * S * 0.12; a = 1; }
      else if (p.r1 < 0.85) { const an = p.r2 * 6.283 + tm * 0.00008; x = cx + Math.cos(an) * m * 0.30; y = cy + Math.sin(an) * m * 0.205; a = 0.5; }
      else { x = cx + (p.r2 - 0.5) * m * 1.1; y = cy + (p.r3 - 0.5) * m * 0.8; a = 0.15; }
    } else if (sc === 'hand') {
      const Px = W * 0.22, Py = H * 0.56, Cx = W * 0.5, Cy = H * 0.50, Rx = W * 0.78, Ry = H * 0.56;
      const T = (tm % 8000) / 8000;
      if (p.r1 < 0.30) { x = W * (0.2 + p.r2 * 0.6); y = H * 0.24 + g2 * 16; a = 0.35; }
      else if (p.r1 < 0.55) { const jj = i % 3, A = [[Px, Py], [Cx, Cy], [Rx, Ry]][jj]; const an = p.r2 * 6.283 + tm * 0.0002; x = A[0] + Math.cos(an) * m * 0.045; y = A[1] + Math.sin(an) * m * 0.04; const phn = T < 0.2 ? 0 : T < 0.6 ? 1 : T < 0.78 ? 2 : 1; a = jj === phn ? 0.9 : 0.45; }
      else if (p.r1 < 0.67) {
        let qx, qy, aa = 1;
        if (T < 0.20) { const t = this.ez(T / 0.20); qx = Px + (Cx - Px) * t; qy = Py + (Cy - Py) * t - Math.sin(t * 3.14) * 34; }
        else if (T < 0.42) { qx = Cx + Math.cos(tm * 0.002 + p.ph) * 15; qy = Cy + Math.sin(tm * 0.002 + p.ph) * 15; }
        else if (T < 0.62) { const t = this.ez((T - 0.42) / 0.20); qx = Cx + (Rx - Cx) * t; qy = Cy + (Ry - Cy) * t - Math.sin(t * 3.14) * 34; }
        else if (T < 0.78) { qx = Rx + Math.cos(tm * 0.002 + p.ph) * 13; qy = Ry + Math.sin(tm * 0.002 + p.ph) * 13; }
        else { const t = this.ez((T - 0.78) / 0.22); qx = Rx + (W * 0.5 - Rx) * t; qy = Ry + (H * 0.24 - Ry) * t; aa = p.r3 < 0.5 ? 1 : 0.25; if (p.amber) { aa = 1; sz = 1.3; } }
        x = qx + (p.r2 - 0.5) * 15; y = qy + (p.r3 - 0.5) * 15; a = aa;
      }
      else { x = p.r2 * W; y = p.r3 * H; a = 0.06; }
    } else if (sc === 'route') {
      const cx = W * 0.5, cy = H * 0.46, act = Math.floor(tm / 2100) % 4;
      const MA = [[0.26, 0.72], [0.42, 0.72], [0.58, 0.72], [0.74, 0.72]];
      if (p.r1 < 0.45) { x = cx + g1 * 20; y = cy + g2 * 17; a = 1; }
      else if (p.r1 < 0.78) { const jj = i % 4, A = MA[jj]; x = W * A[0] + g1 * 22; y = H * A[1] + g2 * 14; a = jj === act ? 0.9 : 0.3; }
      else { const A = MA[act], t = (tm * 0.0005 + p.r4) % 1; x = cx + (W * A[0] - cx) * t + g1 * 7; y = cy + (H * A[1] - cy) * t + g2 * 7; a = 0.8 * (1 - t * 0.4); }
    } else if (sc === 'voice') {
      const k = this.rm ? 0 : Math.floor(tm / 2600) % 5;
      const vx = W * (W < 900 ? 0.5 : 0.56), vy = H * 0.56;
      let OR = m * 0.16;
      if (k === 0) OR *= 1 + 0.05 * Math.sin(tm * 0.0022);
      if (k === 1) OR *= 1 + 0.02 * Math.sin(tm * 0.006 + p.ph);
      if (k === 3) OR *= 1 + 0.10 * Math.abs(Math.sin(tm * 0.006)) * (0.5 + 0.5 * Math.sin(tm * 0.0021));
      const th2 = 6.283 * p.r2, phv = Math.acos(2 * p.r3 - 1);
      const sxx = Math.sin(phv) * Math.cos(th2), syy = Math.cos(phv), szz = Math.sin(phv) * Math.sin(th2);
      const rot = tm * (k === 2 ? 0.001 : 0.00045);
      const xr = sxx * Math.cos(rot) + szz * Math.sin(rot), zr = -sxx * Math.sin(rot) + szz * Math.cos(rot);
      x = vx + xr * OR; y = vy + syy * OR * 0.94; a = 0.3 + 0.62 * (zr * 0.5 + 0.5);
      if (k === 2) { const q = this.SP(p.r2), bb = this.cl(0.55 + 0.45 * Math.sin(tm * 0.0016)); x = x * (1 - bb) + (vx + q.x * OR * 1.2) * bb; y = y * (1 - bb) + (vy + q.y * OR * 1.2) * bb; }
      if (k === 3 && p.r1 < 0.15) { const t2 = (tm * 0.00055 + p.r4) % 1; x = vx + xr * OR * (1 + t2 * 1.8); y = vy + syy * OR * (0.94 + t2 * 1.7); a = (1 - t2) * 0.85; }
      if (k === 4) { const facing = zr > 0.15 && xr * xr + syy * syy < 0.2; a = facing ? 0 : a * 0.5; }
      if (p.amber) { sz = 1.3; a = Math.min(1, a + 0.25); }
    } else if (sc === 'conn') {
      const GA = [[0.22, 0.40], [0.76, 0.38], [0.24, 0.74], [0.76, 0.74]];
      if (p.r1 < 0.22) { const q = this.SP(p.r2); const S = m * 0.06; x = W * 0.5 + q.x * S + g1 * S * 0.15; y = H * 0.54 + q.y * S + g2 * S * 0.15; a = 0.9; }
      else if (p.r1 < 0.86) { const jj = i % 4, A = GA[jj], an = p.r2 * 6.283 + tm * 0.00012, R = m * (0.05 + 0.07 * p.r3); x = W * A[0] + Math.cos(an) * R * 1.35; y = H * A[1] + Math.sin(an) * R * 0.9; a = 0.55; }
      else { const jj = i % 4, A = GA[jj], t = (tm * 0.00025 + p.r4) % 1; x = W * A[0] + (W * 0.5 - W * A[0]) * t; y = H * A[1] + (H * 0.54 - H * A[1]) * t; a = 0.4 * (1 - t * 0.5); }
    } else if (sc === 'hydra') {
      const hn = this.hydraNodes(W, H, 'hydra'), A = hn.pts[i % hn.pts.length];
      x = A[0] + g1 * 5; y = A[1] + g2 * 5; a = 0.9; sz = 1.05;
    } else if (sc === 'mcp') {
      const cx = W * 0.5, cy = H * 0.56, T = (tm % 5600) / 5600;
      if (p.r1 < 0.58) { const q = this.SP(p.r2), S = m * 0.17; x = cx + q.x * S + g1 * S * 0.15; y = cy + q.y * S + g2 * S * 0.15; a = 0.8; if (T > 0.32 && T < 0.62 && p.amber) { a = 1; sz = 1.4; } }
      else if (p.r1 < 0.70) {
        if (T < 0.30) { const t = this.ez(T / 0.30), qx = W * 0.07 + (cx - W * 0.07) * t; x = qx + g1 * 15; y = cy + g2 * 15; a = 1; }
        else if (T < 0.62) { x = cx + g1 * m * 0.15; y = cy + g2 * m * 0.15; a = 0.25; }
        else { const t = this.ez((T - 0.62) / 0.38), qx = cx + (W * 0.93 - cx) * t; x = qx + g1 * 7; y = cy + g2 * 7; a = 1; }
      }
      else { const EP = [[0.07, 0.56], [0.93, 0.56], [0.5, 0.15], [0.5, 0.93]], A = EP[i % 4]; x = W * A[0] + g1 * 10; y = H * A[1] + g2 * 10; a = 0.5; }
    } else if (sc === 'quiet' || sc === 'off') {
      x = p.r1 < 0.5 ? W * 0.05 * p.r2 : W * (1 - 0.05 * p.r2);
      y = p.r3 * H; a = sc === 'quiet' ? 0.22 : 0.05;
    }
    p.tx = x; p.ty = y; p.ta = a; p.tsz = sz;
  }
  drawOver(ctx, d) {
    const { sc, pr, tm, W, H, m } = d;
    const mono = '"JetBrains Mono", ui-monospace, monospace';
    ctx.lineWidth = 1;
    if (sc === 'real') {
      const AX = W < 900 ? 0.74 : 0.60, AY = W < 900 ? 0.26 : 0.55;
      const N = [[0.58, 0.26, 'README · REDIS', 1], [0.82, 0.24, 'SLACK · PROPOSAL', 1], [0.50, 0.66, 'PR #184 · POSTGRES', -1], [0.82, 0.84, 'RUNBOOK · POSTGRES', -1]];
      ctx.textAlign = 'center'; ctx.font = '500 10px ' + mono;
      const th = [0.05, 0.11, 0.17, 0.23];
      for (let i2 = 0; i2 < 4; i2++) {
        const al = this.cl((pr - th[i2]) * 8) * (pr > 0.34 && i2 < 2 ? 0.4 : 0.9);
        if (al < 0.02) continue;
        ctx.globalAlpha = al; ctx.fillStyle = '#9A9A9A';
        ctx.fillText(N[i2][2], W * N[i2][0], H * N[i2][1] + N[i2][3] * (m * 0.05 * 1.5 + 20) + (N[i2][3] < 0 ? 6 : 0));
      }
      if (pr > 0.34) {
        const nx = W * AX, ny = H * AY;
        ctx.globalAlpha = this.cl((pr - 0.34) * 5) * 0.8;
        ctx.strokeStyle = 'rgba(255,255,255,0.24)'; ctx.setLineDash([3, 6]);
        ctx.beginPath(); ctx.moveTo(W * N[0][0], H * N[0][1]); ctx.lineTo(W * N[0][0] + (nx - W * N[0][0]) * 0.6, H * N[0][1] + (ny - H * N[0][1]) * 0.6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(W * N[1][0], H * N[1][1]); ctx.lineTo(W * N[1][0] + (nx - W * N[1][0]) * 0.5, H * N[1][1] + (ny - H * N[1][1]) * 0.5); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = this.cl((pr - 0.34) * 5);
        ctx.strokeStyle = 'rgba(128,82,255,0.6)'; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(W * N[2][0], H * N[2][1]); ctx.lineTo(nx, ny); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(W * N[3][0], H * N[3][1]); ctx.lineTo(nx, ny); ctx.stroke();
        ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.beginPath(); ctx.arc(nx, ny, 10, -0.9, 4.3); ctx.stroke();
      }
      ctx.textAlign = 'left';
    }
    if (sc === 'gap' || sc === 'void') { ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.beginPath(); ctx.ellipse(W * 0.5, H * 0.55, m * 0.21, m * 0.105, 0, -1.05, 4.18); ctx.stroke(); }
    if (sc === 'arch') {
      const cx = W * (W < 1100 ? 0.56 : 0.60), cy = H * (W < 1100 ? 0.64 : 0.56), hn = this.hydraNodes(W, H, 'arch');
      ctx.globalAlpha = this.cl((pr - 0.15) * 4);
      for (let e = 0; e < hn.edges.length; e++) { const [a2, b2] = hn.edges[e]; ctx.strokeStyle = Math.sin(e * 3.7) > 0.75 ? 'rgba(128,82,255,0.42)' : 'rgba(255,255,255,0.13)'; ctx.beginPath(); ctx.moveTo(hn.pts[a2][0], hn.pts[a2][1]); ctx.lineTo(hn.pts[b2][0], hn.pts[b2][1]); ctx.stroke(); }
      ctx.globalAlpha = this.cl((pr - 0.35) * 4);
      ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.beginPath(); ctx.ellipse(cx, cy, m * 0.28, m * 0.19, 0, -1.1, 4.2); ctx.stroke();
      ctx.font = '500 9.5px ' + mono; ctx.fillStyle = '#7A7A84'; ctx.textAlign = 'center';
      const MOD = ['SCOPE', 'EVIDENCE', 'CONFLICTS', 'ABSTENTION', 'HEALTH', 'COMPILER', 'ROUTER', 'RUNTIME', 'TOOL MESH', 'POLICY', 'TRACE'];
      ctx.globalAlpha = this.cl((pr - 0.2) * 4); ctx.fillStyle = '#9A9A9A'; ctx.font = '500 10px ' + mono;
      if (pr > 0.58) {
        ctx.globalAlpha = this.cl((pr - 0.58) * 5);
        ctx.strokeStyle = 'rgba(128,82,255,0.5)'; ctx.beginPath(); ctx.moveTo(cx + m * 0.16, cy - m * 0.02); ctx.lineTo(W * 0.86 - 22, H * 0.50); ctx.stroke();
        ctx.fillStyle = '#9A9A9A'; ctx.fillText('CONTEXT PACK', W * 0.86, H * 0.50 + 34);
      }
      if (pr > 0.76) { ctx.globalAlpha = this.cl((pr - 0.76) * 5); ctx.fillStyle = '#7A7A84'; ctx.fillText('REMEMBER WHAT MATTERS', W * 0.72, H * 0.36); }
      ctx.textAlign = 'left';
    }
    if (sc === 'funnel') {
      const cx = W * (W < 760 ? 0.44 : 0.62), Y = [0.14, 0.29, 0.44, 0.58, 0.72, 0.86], HW = [0.16, 0.115, 0.082, 0.055, 0.032, 0.008];
      const L = ['RAW CONTEXT', 'SCOPE', 'RETRIEVAL', 'GRAPH', 'CURRENT · EVIDENCE', 'CONTEXT PACK'], C = [256, 96, 31, 12, 6, 1];
      const fs = Math.min(5, Math.floor(this.cl((pr - 0.06) / 0.78) * 6));
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.beginPath(); ctx.moveTo(cx - HW[0] * W, H * Y[0]); for (let s2 = 1; s2 < 6; s2++) ctx.lineTo(cx - HW[s2] * W, H * Y[s2]); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + HW[0] * W, H * Y[0]); for (let s2 = 1; s2 < 6; s2++) ctx.lineTo(cx + HW[s2] * W, H * Y[s2]); ctx.stroke();
      ctx.font = '500 10px ' + mono; ctx.textAlign = 'left';
      for (let s2 = 0; s2 < 6; s2++) {
        ctx.globalAlpha = s2 <= fs ? 0.9 : 0.25;
        ctx.fillStyle = s2 === 5 ? '#8052FF' : '#9A9A9A';
        ctx.fillText(L[s2] + ' · ' + C[s2], cx + HW[0] * W + (W < 760 ? 12 : 26), H * Y[s2] + 3);
      }
    }
    if (sc === 'temporal') {
      const tx = W * (W < 900 ? 0.5 : 0.70), ty = H * 0.55, RR = [m * 0.115, m * 0.185, m * 0.255], hov = d.st.hoverRev;
      for (let ring = 0; ring < 3; ring++) {
        let al = [0.26, 0.10, 0.10][ring];
        if (hov >= 0) al = (2 - hov) === ring ? 0.4 : 0.05;
        ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(255,255,255,' + al + ')';
        if (ring === 1) ctx.setLineDash([3, 6]);
        ctx.beginPath(); ctx.ellipse(tx, ty, RR[ring] * 1.3, RR[ring] * 0.88, 0, -1.2 + ring * 0.5, 4.0 + ring * 0.5); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.font = '400 11px ' + mono;
      const LB = ['Postgres', 'proposal', 'Redis'];
      for (let ring = 0; ring < 3; ring++) {
        let al = ring === 0 ? 0.9 : 0.4;
        if (hov >= 0) al = (2 - hov) === ring ? 1 : 0.15;
        ctx.globalAlpha = al; ctx.fillStyle = ring === 0 ? '#FFFFFF' : '#9A9A9A';
        ctx.fillText(LB[ring], tx + RR[ring] * 1.3 + 10, ty + 4);
      }
    }
    if (sc === 'contra') {
      const L = this.ez(this.cl((pr - 0.22) * 2.2)), y0 = H * 0.60, x0 = W * 0.14, xs = W * 0.50, xe0 = W * 0.86;
      ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(xs, y0); ctx.stroke();
      if (L > 0.01) { const xe = xs + (xe0 - xs) * L; ctx.beginPath(); ctx.moveTo(xs, y0); ctx.lineTo(xe, y0 - H * 0.15 * L); ctx.stroke(); ctx.beginPath(); ctx.moveTo(xs, y0); ctx.lineTo(xe, y0 + H * 0.15 * L); ctx.stroke(); }
    }
    if (sc === 'pack') {
      const k = this.ez(this.cl((pr - 0.08) / 0.6)), slide = this.ez(this.cl((pr - 0.8) * 5));
      const px = W * 0.44 + slide * W * 0.14, py = H * 0.55, SRC = [[0.15, 0.30], [0.20, 0.80], [0.80, 0.26], [0.86, 0.72]];
      ctx.globalAlpha = 0.16 + 0.14 * k; ctx.strokeStyle = '#FFFFFF';
      for (let s2 = 0; s2 < 4; s2++) { ctx.beginPath(); ctx.moveTo(W * SRC[s2][0], H * SRC[s2][1]); ctx.lineTo(px, py); ctx.stroke(); }
      const fo = this.focus && this.focus.id === 'packP' && performance.now() < this.focus.until;
      if (fo) { ctx.globalAlpha = 0.9; ctx.font = '500 10px ' + mono; ctx.fillStyle = '#BDBDBD'; ctx.textAlign = 'center'; const OF = [[-0.09, -0.07, 'FACTS'], [0.09, -0.07, 'EVIDENCE'], [-0.09, 0.07, 'CONSTRAINTS'], [0.09, 0.07, 'OPEN QUESTIONS']]; OF.forEach((o) => ctx.fillText(o[2], px + o[0] * m, py + o[1] * m + m * 0.045)); ctx.textAlign = 'left'; }
    }
    if (sc === 'speed') {
      ctx.globalAlpha = 0.9; ctx.font = '500 10px ' + mono; ctx.textAlign = 'center'; ctx.fillStyle = '#7A7A84';
      ctx.fillText('RAW HISTORY', W * 0.30, H * 0.55 + m * 0.26 + 26);
      ctx.fillText('CONTEXT PACK', W * 0.72, H * 0.55 + 40);
      ctx.textAlign = 'left';
    }
    if (sc === 'any') {
      const cx = W * 0.5, cy = H * 0.57, act = Math.floor(tm / 1900) % 5;
      for (let j2 = 0; j2 < 5; j2++) { const A = this.CLPOS[j2]; ctx.globalAlpha = 1; ctx.strokeStyle = j2 === act ? 'rgba(128,82,255,0.55)' : 'rgba(255,255,255,0.14)'; ctx.beginPath(); ctx.moveTo(W * A[0], H * A[1]); ctx.lineTo(cx, cy); ctx.stroke(); }
    }
    if (sc === 'harness') {
      const cx = W * (W < 900 ? 0.5 : 0.62), cy = H * (W < 900 ? 0.74 : 0.56);
      ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(255,255,255,0.13)';
      ctx.beginPath(); ctx.ellipse(cx, cy, m * 0.30, m * 0.205, 0, -1.15, 4.25); ctx.stroke();
      ctx.font = '500 9.5px ' + mono; ctx.fillStyle = '#7A7A84'; ctx.textAlign = 'center';
      const MOD = ['AGENT RUNTIME', 'MODEL ROUTER', 'SKILL ENGINE', 'TOOL MESH', 'POLICY', 'CONTEXT COMPILER', 'TRACE', 'HYDRADB ADAPTER'];
      for (let k2 = 0; k2 < 8; k2++) { const an = -1.1 + k2 * (5.35 / 7); ctx.fillText(MOD[k2], cx + Math.cos(an) * m * 0.345, cy + Math.sin(an) * m * 0.24); }
      ctx.fillStyle = '#9A9A9A'; ctx.font = '500 10px ' + mono;
      ctx.fillText('CONTEXT KERNEL', cx, cy + m * 0.13);
      ctx.textAlign = 'left';
    }
    if (sc === 'hand') {
      ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(255,255,255,0.13)';
      ctx.beginPath(); ctx.moveTo(W * 0.22 + m * 0.05, H * 0.555); ctx.lineTo(W * 0.5 - m * 0.05, H * 0.505); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(W * 0.5 + m * 0.05, H * 0.505); ctx.lineTo(W * 0.78 - m * 0.05, H * 0.555); ctx.stroke();
      ctx.globalAlpha = 0.9; ctx.font = '500 10px ' + mono; ctx.textAlign = 'center'; ctx.fillStyle = '#7A7A84';
      ctx.fillText('PLANNER', W * 0.22, H * 0.56 + m * 0.045 + 24);
      ctx.fillText('CODER', W * 0.5, H * 0.50 + m * 0.045 + 24);
      ctx.fillText('REVIEWER', W * 0.78, H * 0.56 + m * 0.045 + 24);
      ctx.fillText('SHARED MEMORY', W * 0.5, H * 0.24 - 22);
      ctx.textAlign = 'left';
    }
    if (sc === 'route') {
      const cx = W * 0.5, cy = H * 0.46, act = Math.floor(tm / 2100) % 4, MA = [[0.26, 0.72], [0.42, 0.72], [0.58, 0.72], [0.74, 0.72]];
      for (let j2 = 0; j2 < 4; j2++) { ctx.globalAlpha = 1; ctx.strokeStyle = j2 === act ? 'rgba(128,82,255,0.55)' : 'rgba(255,255,255,0.13)'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(W * MA[j2][0], H * MA[j2][1]); ctx.stroke(); }
      ctx.globalAlpha = 0.9; ctx.font = '500 10px ' + mono; ctx.textAlign = 'center'; ctx.fillStyle = '#9A9A9A';
      ctx.fillText('CONTEXT PACK', cx, cy + 40); ctx.textAlign = 'left';
    }
    if (sc === 'conn') {
      const GA = [[0.22, 0.40], [0.76, 0.38], [0.24, 0.74], [0.76, 0.74]];
      ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(255,255,255,0.13)';
      for (let j2 = 0; j2 < 4; j2++) { ctx.beginPath(); ctx.moveTo(W * GA[j2][0], H * GA[j2][1]); ctx.lineTo(W * 0.5, H * 0.54); ctx.stroke(); }
    }
    if (sc === 'hydra') {
      const hn = this.hydraNodes(W, H, 'hydra');
      ctx.globalAlpha = 1;
      for (let e = 0; e < hn.edges.length; e++) { const [a2, b2] = hn.edges[e]; ctx.strokeStyle = Math.sin(e * 3.7) > 0.75 ? 'rgba(128,82,255,0.45)' : 'rgba(255,255,255,0.14)'; ctx.beginPath(); ctx.moveTo(hn.pts[a2][0], hn.pts[a2][1]); ctx.lineTo(hn.pts[b2][0], hn.pts[b2][1]); ctx.stroke(); }
    }
    if (sc === 'voice') {
      const vx = W * (W < 900 ? 0.5 : 0.56), vy = H * 0.56;
      ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.beginPath(); ctx.arc(vx, vy, m * 0.16 * 1.14, 0, 6.283); ctx.stroke();
    }
    if (sc === 'mcp') {
      const EP = [[0.07, 0.56], [0.93, 0.56]];
      ctx.globalAlpha = 0.5; ctx.strokeStyle = '#FFFFFF';
      for (let s2 = 0; s2 < 2; s2++) ctx.strokeRect(W * EP[s2][0] - 5, H * EP[s2][1] - 5, 10, 10);
      ctx.globalAlpha = 0.14; ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.moveTo(W * 0.07, H * 0.56); ctx.lineTo(W * 0.93, H * 0.56); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (!this.rm && this.mx > 0) {
      const near = [];
      for (let i2 = 0; i2 < this.P.length && near.length < 26; i2++) {
        const p2 = this.P[i2];
        if (p2.ca < 0.1) continue;
        const dx = p2.x - this.mx, dy = p2.y - this.my;
        if (dx * dx + dy * dy < 8100) near.push(p2);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      for (let i2 = 1; i2 < near.length; i2++) {
        const a2 = near[i2 - 1], b2 = near[i2];
        const dx = a2.x - b2.x, dy = a2.y - b2.y, d2 = dx * dx + dy * dy;
        if (d2 > 2600) continue;
        ctx.globalAlpha = 0.14 * (1 - d2 / 2600);
        ctx.beginPath(); ctx.moveTo(a2.x, a2.y); ctx.lineTo(b2.x, b2.y); ctx.stroke();
      }
    }
    const hot = this._hot, fo = this.focus && performance.now() < this.focus.until ? this.focus : null;
    const lab = fo || hot;
    if (lab && lab.label) {
      ctx.globalAlpha = 0.95; ctx.font = '500 10px ' + mono; ctx.textAlign = 'center';
      ctx.fillStyle = fo ? '#FFB829' : '#EDEDED';
      ctx.fillText(lab.label, lab.x, lab.y - (lab.r || m * 0.06) - 12);
      ctx.textAlign = 'left';
    }
    ctx.globalAlpha = 1;
  }
  applyHtml(d) {
    const { sc, pr, tm } = d;
    if (!this._q) this._q = {};
    const q = (s) => { if (!this._q[s]) this._q[s] = Array.prototype.slice.call(document.querySelectorAll(s)); return this._q[s]; };
    const F = (name, v) => { const els = q('[data-fx="' + name + '"]'); for (let i2 = 0; i2 < els.length; i2++) { els[i2].style.opacity = v; els[i2].style.transform = 'translateY(' + (1 - v) * 16 + 'px)'; } };
    const S = this.cl.bind(this), rm = this.rm;
    const pb = q('[data-progress]')[0];
    if (pb) { const mx = Math.max(1, document.documentElement.scrollHeight - innerHeight); pb.style.width = (this.cl(scrollY / mx) * 100).toFixed(2) + 'vw'; }
    if (sc === 'real') { F('real-q', rm ? 1 : S((pr - 0.28) * 5)); F('real-a', rm ? 1 : S((pr - 0.46) * 5)); }
    if (sc === 'gap') { F('gap-q', rm ? 1 : S((pr - 0.1) * 5)); F('gap-a', rm ? 1 : S((pr - 0.48) * 5)); }
    if (sc === 'void') F('void-a', rm ? 1 : S((pr - 0.3) * 5));
    if (sc === 'pack') F('pack-l', rm ? 1 : S((pr - 0.55) * 5));
    if (sc === 'contra') F('contra-x', rm ? 1 : S((pr - 0.5) * 4));
    if (sc === 'voice') {
      const k = rm ? 0 : Math.floor(tm / 2600) % 5;
      const vs = q('[data-vs]');
      for (let i2 = 0; i2 < vs.length; i2++) vs[i2].style.color = i2 === k ? '#FFFFFF' : '#7A7A7A';
      const vt = q('[data-vt]');
      for (let i2 = 0; i2 < vt.length; i2++) { const on = (k >= 1 && i2 === 0) || (k === 3 && i2 === 1) || (k === 4 && i2 === 2); vt[i2].style.opacity = on ? 1 : 0.14; }
    }
    if (sc === 'any') { const act = rm ? 0 : Math.floor(tm / 1900) % 5; const cls = q('[data-client]'); for (let i2 = 0; i2 < cls.length; i2++) cls[i2].style.color = i2 === act ? '#FFFFFF' : '#7A7A84'; }
    if (sc === 'route') { const act = rm ? 0 : Math.floor(tm / 2100) % 4; const mo = q('[data-model]'); for (let i2 = 0; i2 < mo.length; i2++) mo[i2].style.color = i2 === act ? '#FFFFFF' : '#7A7A84'; }
    if (sc === 'hand') { const T = rm ? 0.1 : (tm % 8000) / 8000; const phn = T < 0.20 ? 0 : T < 0.42 ? 1 : T < 0.78 ? 2 : 3; const hs = q('[data-ho]'); for (let i2 = 0; i2 < hs.length; i2++) hs[i2].style.color = i2 === phn ? '#FFFFFF' : '#7A7A84'; }
  }
  loop(t) {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame((tt) => this.loop(tt));
    this._lastTick = performance.now();
    try { this.loopImpl(t); } catch (e) { if (!this._loopErr) { this._loopErr = 1; console.error('LACUNA LOOP FAIL', e && e.message, e && e.stack); } }
  }
  loopImpl(t) {
    if (document.hidden && !this._prime) return;
    const cv = this.canvasRef && this.canvasRef.current;
    if (!cv) return;
    const view = this.state.view;
    if (view === 'app') {
      if (cv.style.display !== 'none') cv.style.display = 'none';
      const hc = this.healthRef && this.healthRef.current, vc2 = this.voiceRef && this.voiceRef.current;
      if (hc && hc.width === 300) this.drawHealth();
      if (vc2 && vc2.width === 300) this.drawVoice();
      return;
    }
    if (cv.style.display === 'none') cv.style.display = 'block';
    const W = innerWidth, H = innerHeight;
    if (!this.sized || W !== this.W || H !== this.H) {
      this.W = W; this.H = H; this.sized = 1;
      this.dpr = Math.min(devicePixelRatio || 1, 1.8);
      cv.width = W * this.dpr; cv.height = H * this.dpr;
      this._rk = null;
    }
    let sc = 'hero', pr = 0.3;
    if (view === 'signin' || view === 'signup' || view === 'forgot') sc = 'auth';
    else if (view === 'onboard') sc = 'onboard';
    else { const r = this.detectScene(); sc = r[0]; pr = r[1]; }
    const seen = this._vis[sc] || 0;
    if (pr > seen) this._vis[sc] = pr; else pr = seen;
    this._sc = sc;
    const m = Math.min(W, H);
    const d = { sc, pr, tm: this.rm ? 4000 : t, W, H, m, st: this.state };
    this.applyHtml(d);
    let hot = null;
    if (!this.rm && this.mx > 0 && view === 'landing') {
      const hs = this.hotspots(sc, W, H, m);
      let bd = 1e9;
      for (let i2 = 0; i2 < hs.length; i2++) {
        const dx = this.mx - hs[i2].x, dy = this.my - hs[i2].y, d2 = dx * dx + dy * dy;
        if (d2 < hs[i2].r * hs[i2].r && d2 < bd) { bd = d2; hot = hs[i2]; }
      }
    }
    this._hot = hot;
    if (this.rm) {
      const key = sc + '|' + Math.round(pr * 10) + '|' + W + 'x' + H + '|' + this.state.hoverRev + '|' + this.state.obStep;
      if (key === this._rk) return;
      this._rk = key;
    }
    if (!this._shieldT || t - this._shieldT > 190 || this._prime) { this._shieldT = t; this._shield = this.textRects(); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 0.9;
    const lerp = (this.rm || this._prime) ? 1 : 0.055, drift = this.rm ? 0 : 1;
    const fo = this.focus && performance.now() < this.focus.until ? this.focus : null;
    for (let i = 0; i < this.P.length; i++) {
      const p = this.P[i];
      this.computeTarget(p, i, d);
      let boost = 1;
      const bs = fo || hot;
      if (bs) { const dx = p.tx - bs.x, dy = p.ty - bs.y, rr = (bs.r || m * 0.06) * 1.15; if (dx * dx + dy * dy < rr * rr) boost = fo ? 1.6 : 1.4; else if (fo) boost = 0.75; }
      p.x += (p.tx - p.x) * lerp; p.y += (p.ty - p.y) * lerp;
      p.ca += (p.ta * boost - p.ca) * ((this.rm || this._prime) ? 1 : 0.09);
      let a = Math.min(1, p.ca * (0.35 + p.z * 0.75));
      if (a <= 0.015) continue;
      const s = p.s * (0.7 + p.z * 0.8) * p.tsz * (1 + 0.12 * Math.sin(t * 0.0002 + p.ph * 3) * drift);
      let x = p.x + drift * Math.sin(t * 0.0006 + p.ph) * 1.7 * p.z;
      let y = p.y + drift * Math.cos(t * 0.0005 + p.ph * 1.7) * 1.4 * p.z;
      if (!this.rm && this.mx > 0) {
        const dx = x - this.mx, dy = y - this.my, d2 = dx * dx + dy * dy, R = 150;
        if (d2 < R * R && d2 > 1) { const dd = Math.sqrt(d2), f = (1 - dd / R); const push = f * f * 15 * p.z; x += dx / dd * push; y += dy / dd * push; }
      }
      const SH = this._shield;
      if (SH) {
        for (let q = 0; q < SH.length; q++) {
          const rq = SH[q];
          if (x > rq[0] && x < rq[2] && y > rq[1] && y < rq[3]) { a *= 0.07; break; }
          if (x > rq[0] - 26 && x < rq[2] + 26 && y > rq[1] - 20 && y < rq[3] + 20) {
            const cxq = (rq[0] + rq[2]) / 2, cyq = (rq[1] + rq[3]) / 2;
            const ox = x < cxq ? -1 : 1, oy = y < cyq ? -1 : 1;
            x += ox * 5; y += oy * 3; a *= 0.42; break;
          }
        }
      }
      if (a <= 0.015) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.col; ctx.strokeStyle = p.col;
      if (p.k < 13) ctx.fillRect(x, y, s, s);
      else if (p.k < 15) { const r = s * 2.1; ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.87, y + r * 0.5); ctx.lineTo(x - r * 0.87, y + r * 0.5); ctx.closePath(); ctx.stroke(); }
      else if (p.k < 17) { ctx.beginPath(); ctx.moveTo(x - p.lc * s * 2.6, y - p.ls * s * 2.6); ctx.lineTo(x + p.lc * s * 2.6, y + p.ls * s * 2.6); ctx.stroke(); }
      else if (p.k < 19) { ctx.beginPath(); ctx.arc(x, y, s * 1.5, 0, 6.283); ctx.stroke(); }
      else ctx.strokeRect(x - s, y - s, s * 2, s * 2);
    }
    this.drawOver(ctx, d);
    this._prime = false;
  }
  drawVoice() {
    const cv = this.voiceRef && this.voiceRef.current;
    if (!cv) return;
    const s = 340, dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = s * dpr; cv.height = s * dpr;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, s, s);
    const cx = s / 2, cy = s / 2, R2 = s * 0.34, GA = 2.39996;
    for (let i = 0; i < 640; i++) {
      const v = (i + 0.5) / 640, phv = Math.acos(2 * v - 1), th = GA * i;
      const sx = Math.sin(phv) * Math.cos(th), sy = Math.cos(phv), sz = Math.sin(phv) * Math.sin(th);
      const front = sz * 0.5 + 0.5;
      ctx.globalAlpha = 0.10 + front * 0.72;
      ctx.fillStyle = i % 41 === 0 ? '#8052FF' : (i % 157 === 0 ? '#FFB829' : '#BDBDBD');
      const r = 0.8 + front * 1.1;
      ctx.fillRect(cx + sx * R2, cy + sy * R2 * 0.94, r, r);
    }
    ctx.globalAlpha = 0.13; ctx.strokeStyle = '#FFFFFF';
    ctx.beginPath(); ctx.arc(cx, cy, R2 * 1.12, 0, 6.283); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  drawHealth() {
    const cv = this.healthRef && this.healthRef.current;
    if (!cv) return;
    const s = 400, dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = s * dpr; cv.height = s * dpr;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, s, s);
    const cats = this.HEALTH, total = cats.reduce((a, c) => a + c.n, 0), sel = this.state.healthSel;
    let acc = 0;
    const bounds = cats.map((c) => { const b = [acc / total, (acc + c.n) / total]; acc += c.n; return b; });
    const S = s * 0.37, cx = s / 2, cy = s / 2 + 8, dots = 360;
    for (let i = 0; i < dots; i++) {
      const t = i / dots;
      let ci = 0;
      for (let b = 0; b < bounds.length; b++) if (t >= bounds[b][0] && t < bounds[b][1]) { ci = b; break; }
      const q = this.SP(t);
      const jx = Math.sin(i * 12.9) * 5, jy = Math.sin(i * 7.7) * 5;
      const on = sel < 0 || sel === ci;
      ctx.globalAlpha = on ? 0.95 : 0.12;
      ctx.fillStyle = cats[ci].col;
      ctx.beginPath();
      ctx.arc(cx + q.x * S + jx, cy + q.y * S + jy, sel === ci ? 2.6 : 1.8, 0, 6.283);
      ctx.fill();
    }
    const q0 = this.SP(0.004);
    ctx.globalAlpha = 1; ctx.fillStyle = '#FFB829';
    ctx.beginPath(); ctx.arc(cx + q0.x * S, cy + q0.y * S, 4, 0, 6.283); ctx.fill();
  }
}
