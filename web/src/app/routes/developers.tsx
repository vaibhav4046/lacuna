import { useState } from 'react';

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

const head = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#7A7A7A' } as const;
const note = { fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.16em', color: '#7A7A7A' } as const;

/**
 * The MCP server, as something a reader can connect rather than read about.
 *
 * This page used to say SERVER · NOT CONFIGURED, which was true of the
 * deployment and not of the code: the server spoke Streamable HTTP and nothing
 * mounted it, so it could only ever be run by somebody who had cloned the
 * repository. It is mounted now, so the page shows the endpoint, the config to
 * paste, and a button that calls the live server and prints what came back.
 */
export function Mcp() {
  const [probe, setProbe] = useState<'idle' | 'running' | string>('idle');
  const [copied, setCopied] = useState(false);
  const endpoint = `${window.location.origin}/mcp`;

  const config = `{
  "mcpServers": {
    "lacuna": {
      "type": "http",
      "url": "${endpoint}"
    }
  }
}`;

  async function callIt() {
    setProbe('running');
    try {
      const response = await fetch('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      const body = await response.json() as { result?: { tools?: { name: string }[] } };
      const names = (body.result?.tools ?? []).map((tool) => tool.name);
      setProbe(names.length > 0 ? `${names.length} TOOLS · ${names.join(' · ')}` : 'THE SERVER ANSWERED WITH NO TOOLS');
    } catch {
      setProbe('THE SERVER DID NOT ANSWER');
    }
  }

  return (
    <div style={{ maxWidth: '880px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '26px' }}>
      <div style={{ border: '1px solid rgba(128,82,255,0.4)', borderRadius: '10px', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
        <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#8052FF' }}></span>
        <span style={{ fontFamily: MONO, fontSize: '10.5px', letterSpacing: '0.18em', color: '#FFFFFF' }}>SERVER · LIVE</span>
        <span style={{ fontFamily: MONO, fontSize: '11px', color: '#B79BFF' }}>{endpoint}</span>
      </div>

      <p style={{ fontSize: '14.5px', color: '#BDBDBD', margin: 0, maxWidth: '72ch', lineHeight: 1.6 }}>
        Streamable HTTP, no key, no account. By default it reads the public workspace, over the
        same resolver, and every tool is a read. Point any MCP client at the URL above from
        wherever that client runs. To read a workspace you ingested into, add the header{' '}
        <span style={{ fontFamily: MONO, color: '#B79BFF' }}>x-lacuna-workspace</span> with the
        handle the ingest report shows; the handle is unguessable and read only.
      </p>

      {/*
        The web app connects from a browser, so it sends a preflight before it
        sends anything else. That preflight used to be answered 405 and the
        connection was never attempted: the endpoint looked broken while working
        perfectly from a terminal. It answers now, which is the whole reason
        these instructions can exist.
      */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', border: '1px solid rgba(128,82,255,0.32)', borderRadius: '10px', padding: '16px 18px' }}>
        <span style={{ ...note, letterSpacing: '0.2em', color: '#B79BFF' }}>ADD IT TO CLAUDE</span>
        <p style={{ fontSize: '14.5px', color: '#BDBDBD', margin: 0, lineHeight: 1.7, maxWidth: '70ch' }}>
          In Claude, open Settings, then Connectors, then Add custom connector, and paste the URL
          above. There is no key and no OAuth step: every tool is a read against the public
          workspace. Claude will list five tools once it connects.
        </p>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', paddingTop: '4px' }}>
          <code style={{ fontFamily: MONO, fontSize: '12px', color: '#FFFFFF', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '6px', padding: '7px 11px' }}>{endpoint}</code>
          <button
            className="hv-text"
            type="button"
            onClick={() => { void navigator.clipboard.writeText(endpoint).then(() => setCopied(true)).catch(() => setCopied(false)); }}
            style={{ background: 'none', cursor: 'pointer', borderRadius: '7px', padding: '8px 13px', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.16em', border: '1px solid rgba(255,255,255,0.18)', color: '#BDBDBD' }}
          >{copied ? 'COPIED' : 'COPY URL'}</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <span style={{ ...note, letterSpacing: '0.2em' }}>CLAUDE CODE, CURSOR AND OTHER LOCAL CLIENTS</span>
        <pre style={{ margin: 0, padding: '14px 16px', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '9px', overflowX: 'auto', fontFamily: MONO, fontSize: '12px', color: '#BDBDBD', lineHeight: 1.7 }}>{config}</pre>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <span style={{ ...note, letterSpacing: '0.2em' }}>OR FROM A TERMINAL</span>
        <pre style={{ margin: 0, padding: '14px 16px', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '9px', overflowX: 'auto', fontFamily: MONO, fontSize: '11.5px', color: '#BDBDBD', lineHeight: 1.7 }}>{`curl -s ${endpoint} \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`}</pre>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: '20px' }}>
        <span style={{ ...note, letterSpacing: '0.2em' }}>TOOLS</span>
        <span style={{ fontFamily: MONO, fontSize: '12px', letterSpacing: '0.08em', color: '#BDBDBD', lineHeight: 2 }}>lacuna_ask · lacuna_explain · lacuna_timeline · lacuna_read_question · lacuna_health</span>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginTop: '8px' }}>
          <button
            className="hv-text"
            onClick={() => void callIt()}
            style={{ background: 'none', cursor: 'pointer', borderRadius: '7px', padding: '8px 14px', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.12em', border: '1px solid rgba(128,82,255,0.55)', color: '#FFFFFF' }}
          >
            CALL THE SERVER
          </button>
          {probe === 'idle' ? null : (
            <span style={{ fontFamily: MONO, fontSize: '10.5px', letterSpacing: '0.1em', color: probe === 'running' ? '#7A7A7A' : '#B79BFF' }}>
              {probe === 'running' ? 'CALLING…' : probe}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

const TABS = ['TypeScript', 'REST', 'MCP'];

export function Sdk() {
  const [tab, setTab] = useState(0);
  const sample = DEVCODE[tab] ?? DEVCODE[0]!;

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '26px' }}>
      <div style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: MONO, fontSize: '11px', letterSpacing: '0.1em', color: '#BDBDBD' }}>LACUNA_API_KEY · NOT ISSUED</span>
        {/* Settings has no issuer, so telling a reader to go there is a
            promise the product does not keep. It says what is true instead. */}
        <span style={note}>NO ACTIVE KEY · KEY ISSUING NOT IMPLEMENTED</span>
      </div>
      <div style={{ display: 'flex', gap: 'clamp(18px, 3vw, 38px)', borderBottom: '1px solid rgba(255,255,255,0.10)' }}>
        {TABS.map((l, i) => (
          <button key={l} onClick={() => setTab(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px 2px 0', textAlign: 'left' }}>
            <span style={{ fontFamily: MONO, fontSize: '11px', fontWeight: 500, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#9A9A9A' }}>{l}</span>
            <span style={{ display: 'block', height: '2px', background: tab === i ? '#8052FF' : 'transparent', marginTop: '9px' }}></span>
          </button>
        ))}
      </div>
      {/*
        Per tab, because one banner across all three said the MCP server was a
        design contract while it was answering requests. Understating what works
        costs the same credibility as overstating it.
      */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', border: sample.shipped ? '1px solid rgba(128,82,255,0.45)' : '1px solid rgba(255,184,41,0.35)', borderRadius: '7px', alignSelf: 'flex-start' }}>
        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: sample.shipped ? '#8052FF' : '#FFB829', flexShrink: 0 }}></span>
        <span style={{ fontFamily: MONO, fontSize: '11.5px', letterSpacing: '0.16em', color: sample.shipped ? '#8052FF' : '#FFB829' }}>{sample.note}</span>
      </div>
      <pre style={{ margin: 0, fontFamily: MONO, fontSize: '13px', lineHeight: 1.85, color: '#BDBDBD', whiteSpace: 'pre-wrap', maxWidth: '76ch', overflowX: 'auto' }}>{sample.code}</pre>
      <span style={{ ...note, letterSpacing: '0.14em', lineHeight: 2 }}>ENVELOPE · status · answer · evidence · revisions · conflicts · abstain_reason · context_pack_id · trace_id · source_state<br />THE IMPLEMENTED API IS THE SOURCE OF TRUTH</span>
    </div>
  );
}

/** The seven commands the shipped CLI really has. */
const CLI_COMMANDS = 'lacuna doctor · status · read · ask · explain · timeline · bench';

export function Cli() {
  const health = useHealth();
  const hydra = hydraState(health);

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '12px 22px', maxWidth: '560px', fontFamily: MONO }}>
        <span style={{ fontSize: '11px', color: '#7A7A7A' }}>RUN</span><span style={{ fontSize: '12.5px', color: '#BDBDBD' }}>$ npm run cli -- doctor</span>
        <span style={{ fontSize: '11px', color: '#7A7A7A' }}>ASK</span><span style={{ fontSize: '12.5px', color: '#BDBDBD' }}>$ npm run cli -- ask session-store runs_on</span>
        <span style={{ fontSize: '11px', color: '#7A7A7A' }}>JSON</span><span style={{ fontSize: '12.5px', color: '#BDBDBD' }}>$ npm run cli -- ask session-store runs_on --json</span>
      </div>
      <div style={{ border: '1px solid rgba(255,255,255,0.10)', borderRadius: '10px', background: '#030303', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', padding: '9px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)', ...note, letterSpacing: '0.2em' }}>
          <span style={{ color: '#9A9A9A' }}>LACUNA TERMINAL</span>
          <span>THIS WORKSPACE</span>
        </div>
        <pre style={{ margin: 0, padding: '24px 22px', fontFamily: MONO, fontSize: '12.5px', lineHeight: 1.9, color: '#BDBDBD', whiteSpace: 'pre-wrap' }}>
          {'  '}<span style={{ color: '#FFB829' }}>·</span>{'  '}<span style={{ color: '#FFFFFF' }}>L A C U N A</span>
          {'\n  '}<span style={{ color: '#7A7A7A' }}>context for long-running agents</span>
          {'\n\n  hydradb  '}<span style={{ color: hydra === 'CONNECTED' ? '#15846E' : '#9A9A9A' }}>{hydra === UNCHECKED ? '—' : `● ${hydra.toLowerCase()}`}</span>
          {'\n  context  '}<span style={{ color: '#BDBDBD' }}>{hydra === 'CONNECTED' ? 'ready' : 'unavailable'}</span>
          <span style={{ color: '#8052FF' }}>{'\n\n❯'}</span>
          {' '}<span style={{ color: '#8052FF', animation: 'lpulse 1.1s steps(2) infinite' }}>█</span>
        </pre>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', padding: '8px 16px', background: 'rgba(255,255,255,0.04)', fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.18em' }}>
          <span style={{ color: hydra === 'CONNECTED' ? '#15846E' : '#9A9A9A' }}>● {hydra === UNCHECKED ? '—' : hydra}</span>
          <span style={{ color: '#9A9A9A' }}>LOCAL WORKER · SAME MEMORY</span>
          <span style={{ color: '#7A7A7A' }}>⌘K</span>
        </div>
      </div>
      <span style={{ fontFamily: MONO, fontSize: '10.5px', letterSpacing: '0.12em', color: '#7A7A84' }}>{CLI_COMMANDS}</span>
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
            <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.14em', color: '#7A7A7A' }}>{c.g}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: dotFor(c.st) }}></span>
              <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.12em', color: '#BDBDBD' }}>{c.st}</span>
            </span>
            <span style={{ fontFamily: MONO, fontSize: '11px', color: '#9A9A9A' }}>{c.scope}</span>
            <span style={{ fontFamily: MONO, fontSize: '11px', color: '#7A7A7A' }}>{c.sync}</span>
          </div>
        ))}
      </div>
      <span style={note}>EXACT LIVE SUPPORT VERIFIED AGAINST HYDRADB BEFORE ANY CONNECTOR IS MARKED CONNECTED</span>
    </div>
  );
}
