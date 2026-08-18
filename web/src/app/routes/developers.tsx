import { useState } from 'react';
import { useLoaded } from '../../api/client';
import { hydraState, useHealth, UNCHECKED } from '../../api/health';
import { CONNECTOR_GROUPS, dotFor } from '../../design/connectors';
import { icStyle } from '../../design/icons';
import { MONO } from '../../design/mark';
import { DEVCODE } from '../../landing/copy';

/**
 * The DEVELOPERS group: MCP, SDK · API, CLI and Connectors.
 *
 * Three of these describe surfaces that exist and one describes surfaces that
 * do not yet connect. The rule is the same either way: a state word is a
 * checked state, and an example is only shown when the thing it demonstrates
 * is real.
 */

const head = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#5E5E5E' } as const;
const note = { fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.16em', color: '#5E5E5E' } as const;

export function Mcp() {
  const calls = useLoaded<readonly unknown[]>('/api/workspace/runs');

  return (
    <div style={{ maxWidth: '880px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '28px' }}>
      <div style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
        <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#5E5E5E' }}></span>
        <span style={{ fontFamily: MONO, fontSize: '10.5px', letterSpacing: '0.18em', color: '#BDBDBD' }}>SERVER · NOT CONFIGURED</span>
        <span style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.12em', color: '#5E5E5E' }}>LACUNA-CONTEXT · THE HIGHER-LEVEL CONTEXT CONTRACT OVER HYDRADB MCP</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '12px 22px', maxWidth: '560px' }}>
        {['Get the config for your client', "Add it to the client's MCP settings", 'Restart the client', 'Context is available'].map((step, i) => (
          <span key={step} style={{ display: 'contents' }}>
            <span style={{ fontFamily: MONO, fontSize: '11px', color: '#5E5E5E' }}>{i + 1}</span>
            <span style={{ fontSize: '15px', color: '#BDBDBD' }}>{step}</span>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: '20px' }}>
        <span style={{ ...note, letterSpacing: '0.2em' }}>TOOLS</span>
        <span style={{ fontFamily: MONO, fontSize: '12px', letterSpacing: '0.08em', color: '#BDBDBD', lineHeight: 2 }}>lacuna_ask · lacuna_explain · lacuna_timeline · lacuna_health</span>
        <span style={{ ...note, letterSpacing: '0.2em', marginTop: '10px' }}>RECENT CALLS</span>
        <span style={{ fontSize: '14px', color: '#9A9A9A' }}>
          {calls.state === 'ready' && calls.value.length === 0 ? 'No calls yet. Calls appear when a client connects.' : '—'}
        </span>
      </div>
    </div>
  );
}

const TABS = ['TypeScript', 'REST', 'MCP'];

export function Sdk() {
  const [tab, setTab] = useState(0);

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '26px' }}>
      <div style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: MONO, fontSize: '11px', letterSpacing: '0.1em', color: '#BDBDBD' }}>LACUNA_API_KEY · NOT ISSUED</span>
        <span style={note}>NO ACTIVE KEY · ISSUE ONE FROM SETTINGS</span>
      </div>
      <div style={{ display: 'flex', gap: 'clamp(18px, 3vw, 38px)', borderBottom: '1px solid rgba(255,255,255,0.10)' }}>
        {TABS.map((l, i) => (
          <button key={l} onClick={() => setTab(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px 2px 0', textAlign: 'left' }}>
            <span style={{ fontFamily: MONO, fontSize: '11px', fontWeight: 500, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#9A9A9A' }}>{l}</span>
            <span style={{ display: 'block', height: '2px', background: tab === i ? '#8052FF' : 'transparent', marginTop: '9px' }}></span>
          </button>
        ))}
      </div>
      <pre style={{ margin: 0, fontFamily: MONO, fontSize: '13px', lineHeight: 1.85, color: '#BDBDBD', whiteSpace: 'pre-wrap', maxWidth: '76ch' }}>{DEVCODE[tab]}</pre>
      <span style={{ ...note, letterSpacing: '0.14em', lineHeight: 2 }}>ENVELOPE · status · answer · evidence · revisions · conflicts · abstain_reason · context_pack_id · trace_id · source_state<br />CONTRACT SHOWN AS DESIGNED · THE IMPLEMENTED API IS THE SOURCE OF TRUTH</span>
    </div>
  );
}

/** The six commands the shipped CLI really has. */
const CLI_COMMANDS = 'lacuna doctor · status · ask · explain · timeline · bench';

export function Cli() {
  const health = useHealth();
  const hydra = hydraState(health);

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '12px 22px', maxWidth: '560px', fontFamily: MONO }}>
        <span style={{ fontSize: '11px', color: '#5E5E5E' }}>RUN</span><span style={{ fontSize: '12.5px', color: '#BDBDBD' }}>$ npm run cli -- doctor</span>
        <span style={{ fontSize: '11px', color: '#5E5E5E' }}>ASK</span><span style={{ fontSize: '12.5px', color: '#BDBDBD' }}>$ npm run cli -- ask session-store runs_on</span>
        <span style={{ fontSize: '11px', color: '#5E5E5E' }}>JSON</span><span style={{ fontSize: '12.5px', color: '#BDBDBD' }}>$ npm run cli -- ask session-store runs_on --json</span>
      </div>
      <div style={{ border: '1px solid rgba(255,255,255,0.10)', borderRadius: '10px', background: '#030303', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', padding: '9px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)', ...note, letterSpacing: '0.2em' }}>
          <span style={{ color: '#9A9A9A' }}>LACUNA TERMINAL</span>
          <span>THIS WORKSPACE</span>
        </div>
        <pre style={{ margin: 0, padding: '24px 22px', fontFamily: MONO, fontSize: '12.5px', lineHeight: 1.9, color: '#BDBDBD', whiteSpace: 'pre-wrap' }}>
          {'  '}<span style={{ color: '#FFB829' }}>·</span>{'  '}<span style={{ color: '#FFFFFF' }}>L A C U N A</span>
          {'\n  '}<span style={{ color: '#5E5E5E' }}>context for long-running agents</span>
          {'\n\n  hydradb  '}<span style={{ color: hydra === 'CONNECTED' ? '#15846E' : '#9A9A9A' }}>{hydra === UNCHECKED ? '—' : `● ${hydra.toLowerCase()}`}</span>
          {'\n  context  '}<span style={{ color: '#BDBDBD' }}>{hydra === 'CONNECTED' ? 'ready' : 'unavailable'}</span>
          <span style={{ color: '#8052FF' }}>{'\n\n❯'}</span>
          {' '}<span style={{ color: '#8052FF', animation: 'lpulse 1.1s steps(2) infinite' }}>█</span>
        </pre>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', padding: '8px 16px', background: 'rgba(255,255,255,0.04)', fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.18em' }}>
          <span style={{ color: hydra === 'CONNECTED' ? '#15846E' : '#9A9A9A' }}>● {hydra === UNCHECKED ? '—' : hydra}</span>
          <span style={{ color: '#9A9A9A' }}>LOCAL WORKER · SAME MEMORY</span>
          <span style={{ color: '#5E5E5E' }}>⌘K</span>
        </div>
      </div>
      <span style={{ fontFamily: MONO, fontSize: '10.5px', letterSpacing: '0.12em', color: '#71717A' }}>{CLI_COMMANDS}</span>
      <span style={note}>THESE ARE THE COMMANDS THAT EXIST · THE DESIGNED SET IS LARGER AND LANDS AS EACH ONE IS BUILT</span>
    </div>
  );
}

interface ConnectorRow {
  readonly n: string;
  readonly g: string;
  readonly st: string;
  readonly scope: string;
  readonly sync: string;
}

const CONN_GRID = '0.9fr 0.7fr 1fr 0.8fr 0.8fr';

/** The catalogue, flattened, with the same states the landing page shows. */
const ROWS: readonly ConnectorRow[] = CONNECTOR_GROUPS.flatMap((group) =>
  group.items.map((item) => ({ n: item.n, g: group.h, st: item.st, scope: '—', sync: '—' })),
);

export function Connectors() {
  const [search, setSearch] = useState('');
  const order = ['CONNECTED', 'SYNCING', 'AVAILABLE', 'PLANNED'];
  const shown = ROWS
    .filter((r) => search.trim() === '' || r.n.toLowerCase().includes(search.trim().toLowerCase()))
    .slice()
    .sort((a, b) => order.indexOf(a.st) - order.indexOf(b.st));

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '22px' }}>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="fv-violet" type="text" placeholder="Search connectors" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: '200px', background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '8px', padding: '10px 14px', color: '#FFFFFF', fontFamily: MONO, fontSize: '12px', outline: 'none' }} />
        <span style={note}>CONNECTED FIRST · THEN AVAILABLE · THEN PLANNED</span>
      </div>
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: CONN_GRID, gap: '16px', padding: '8px 4px', borderBottom: '1px solid rgba(255,255,255,0.14)', ...head }}>
          <span>CONNECTOR</span><span>GROUP</span><span>STATUS</span><span>SCOPE</span><span>LAST SYNC</span>
        </div>
        {shown.map((c) => (
          <div key={c.n} className="hv-surface3" style={{ display: 'grid', gridTemplateColumns: CONN_GRID, gap: '16px', alignItems: 'baseline', padding: '14px 4px', borderBottom: '1px solid rgba(255,255,255,0.07)', transition: 'background 140ms ease' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
              <span style={icStyle(c.n, 14)}></span>
              <span style={{ fontSize: '14px', color: '#FFFFFF' }}>{c.n}</span>
            </span>
            <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.14em', color: '#5E5E5E' }}>{c.g}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: dotFor(c.st) }}></span>
              <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.12em', color: '#BDBDBD' }}>{c.st}</span>
            </span>
            <span style={{ fontFamily: MONO, fontSize: '11px', color: '#9A9A9A' }}>{c.scope}</span>
            <span style={{ fontFamily: MONO, fontSize: '11px', color: '#5E5E5E' }}>{c.sync}</span>
          </div>
        ))}
      </div>
      <span style={note}>EXACT LIVE SUPPORT VERIFIED AGAINST HYDRADB BEFORE ANY CONNECTOR IS MARKED CONNECTED</span>
    </div>
  );
}
