import { useCallback, useEffect, useMemo, useState } from 'react';

import { hydraState, useHealth, UNCHECKED } from '../../api/health';
import { MONO } from '../../design/mark';
import { DEVCODE } from '../../landing/copy';
import { CLI_COMMAND_NAMES, MCP_TOOLS_LIST_REQUEST, mcpToolNames } from '../product-contracts';
import { McpProbeCoordinator, mcpServerStatus } from '../mcp-status';

/**
 * The DEVELOPERS group: MCP, SDK · API, CLI and Connectors.
 *
 * Three of these describe surfaces that exist and one describes surfaces that
 * do not yet connect. The rule is the same either way: a state word is a
 * checked state, and an example is only shown when the thing it demonstrates
 * is real.
 */

const note = { fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.16em', color: '#7A7A7A' } as const;

async function readMcpToolNames(signal?: AbortSignal): Promise<readonly string[]> {
  const response = await fetch('/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify(MCP_TOOLS_LIST_REQUEST),
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error('MCP tools/list did not answer');
  return mcpToolNames(await response.json() as unknown);
}

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
  const [tools, setTools] = useState<readonly string[] | null>(null);
  const probes = useMemo(() => new McpProbeCoordinator(), []);
  const endpoint = `${window.location.origin}/mcp`;
  const serverStatus = mcpServerStatus(tools);

  const config = `{
  "mcpServers": {
    "lacuna": {
      "type": "http",
      "url": "${endpoint}"
    }
  }
}`;

  const listTools = useCallback(async (showResult: boolean) => {
    if (showResult) {
      setProbe('running');
      setTools(null);
    }
    const result = await probes.run(readMcpToolNames);
    if (result.kind === 'superseded') return;
    if (result.kind === 'success') {
      const names = result.value;
      setTools(names);
      if (showResult) setProbe(names.length > 0 ? `${names.length} TOOLS · ${names.join(' · ')}` : 'THE SERVER ANSWERED WITH NO TOOLS');
    } else {
      setTools([]);
      if (showResult) setProbe('THE SERVER DID NOT ANSWER');
    }
  }, [probes]);

  useEffect(() => {
    void listTools(false);
    return () => probes.dispose();
  }, [listTools, probes]);

  return (
    <div style={{ maxWidth: '880px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '26px' }}>
      <div style={{ border: '1px solid rgba(128,82,255,0.4)', borderRadius: '10px', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
        <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: serverStatus === 'live' ? '#8052FF' : serverStatus === 'checking' ? '#7A7A7A' : '#FFB829' }}></span>
        <span style={{ fontFamily: MONO, fontSize: '10.5px', letterSpacing: '0.18em', color: '#FFFFFF' }}>SERVER · {serverStatus.toUpperCase()}</span>
        <span style={{ fontFamily: MONO, fontSize: '11px', color: '#B79BFF' }}>{endpoint}</span>
      </div>

      <p style={{ fontSize: '14.5px', color: '#BDBDBD', margin: 0, maxWidth: '72ch', lineHeight: 1.6 }}>
        Streamable HTTP, no key, no account. By default it reads the public workspace, over the
        same resolver, and every tool is a read. Point any MCP client at the URL above from
        wherever that client runs. For private memory, sign in and issue a random capability on
        the Tools screen. Lacuna stores only its digest. It expires 30 days after issue and can be revoked earlier.
        Prefer sending it as{' '}
        <span style={{ fontFamily: MONO, color: '#B79BFF' }}>Authorization: Bearer &lt;capability&gt;</span>.
        The <span style={{ fontFamily: MONO, color: '#B79BFF' }}>/mcp/w/&lt;capability&gt;</span> path
        remains available only for clients that cannot set headers because URLs may be recorded in logs.
        The server resolves that capability to its workspace; a caller-supplied workspace name is never trusted.
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
          workspace. The live tool list below is read directly from this endpoint.
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
        <span style={{ fontFamily: MONO, fontSize: '12px', letterSpacing: '0.08em', color: '#BDBDBD', lineHeight: 2 }}>
          {tools === null ? 'READING THE LIVE SERVER…' : tools.length === 0 ? 'THE LIVE TOOL LIST DID NOT LOAD' : `${tools.length} · ${tools.join(' · ')}`}
        </span>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginTop: '8px' }}>
          <button
            className="hv-text"
            onClick={() => void listTools(true)}
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
      <span style={{ fontFamily: MONO, fontSize: '10.5px', letterSpacing: '0.12em', color: '#7A7A84' }}>{CLI_COMMAND_NAMES.map((command) => `lacuna ${command}`).join(' · ')}</span>
      <span style={note}>THESE ARE THE COMMANDS THAT EXIST · THE DESIGNED SET IS LARGER AND LANDS AS EACH ONE IS BUILT</span>
    </div>
  );
}
