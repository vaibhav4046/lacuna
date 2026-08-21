import { useState } from 'react';

import { postFor, postJson } from '../../api/client';
import { useScope, useScoped } from '../../api/scope';
import { MONO } from '../../design/mark';
import type { RegisteredToolRecord } from '../agents/contracts';
import { Empty, Failed, Stage } from '../state';

const head = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#7A7A7A' } as const;
const note = { fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.13em', color: '#7A7A7A' } as const;

function at(value: string | null): string {
  if (value === null) return 'NOT VERIFIED BY A RUN YET';
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? 'UNKNOWN' : parsed.toLocaleString();
}

interface McpCapabilityResponse {
  readonly capability: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly endpoint: string;
}

function McpAccess() {
  const scope = useScope();
  const [issued, setIssued] = useState<McpCapabilityResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const endpoint = typeof window === 'undefined' ? '/mcp' : `${window.location.origin}/mcp`;

  async function issue() {
    setBusy(true);
    setProblem(null);
    const result = await postFor<McpCapabilityResponse>('/api/workspace/mcp/capabilities', {});
    setBusy(false);
    if (result === null) {
      setProblem('A private MCP capability could not be issued.');
      return;
    }
    setIssued(result);
  }

  async function copy() {
    if (issued === null) return;
    try {
      await navigator.clipboard.writeText(issued.capability);
      setProblem('Capability copied. Treat it like a password.');
    } catch {
      setProblem('Clipboard access was refused. Select and copy the capability manually.');
    }
  }

  async function revoke() {
    if (issued === null) return;
    setBusy(true);
    setProblem(null);
    const result = await postJson('/api/workspace/mcp/capabilities/revoke', { capability: issued.capability });
    setBusy(false);
    if (!result.ok) {
      setProblem('The capability could not be revoked.');
      return;
    }
    setIssued(null);
    setProblem('Capability revoked. Clients using it no longer have private access.');
  }

  if (scope.demo) {
    return (
      <section style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', padding: '16px' }}>
        <div style={{ ...head, paddingBottom: '7px', color: '#B79BFF' }}>REMOTE MCP</div>
        <p style={{ fontSize: '13px', color: '#9A9A9A', lineHeight: 1.6, margin: 0 }}>
          Public tools are read-only at <code>{endpoint}</code>. Sign in to mint a random capability
          for private memory reads and governed <code>remember</code> writes. Lacuna stores only its
          digest. It expires 30 days after issue and can be revoked earlier.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="mcp-access" style={{ border: '1px solid rgba(128,82,255,0.42)', borderRadius: '10px', padding: '16px', background: 'rgba(128,82,255,0.045)' }}>
      <div id="mcp-access" style={{ ...head, paddingBottom: '7px', color: '#B79BFF' }}>PRIVATE MCP ACCESS</div>
      <p style={{ fontSize: '13px', color: '#9A9A9A', lineHeight: 1.6, margin: '0 0 14px', maxWidth: '78ch' }}>
        Mint a random bearer for this workspace. Lacuna stores only its digest; the raw value is
        shown in this browser once, expires 30 days after issue and can be revoked earlier. Prefer
        the Authorization header. The path form is only for clients that cannot set headers because
        URLs may be recorded in infrastructure logs.
      </p>
      {issued === null ? (
        <button className="hv-violet" type="button" disabled={busy} onClick={() => { void issue(); }} style={{ border: 0, borderRadius: '7px', padding: '10px 14px', background: '#8052FF', color: '#FFFFFF', cursor: busy ? 'wait' : 'pointer' }}>
          {busy ? 'ISSUING…' : 'ISSUE PRIVATE CAPABILITY'}
        </button>
      ) : (
        <div style={{ display: 'grid', gap: '12px' }}>
          <div>
            <div style={head}>ENDPOINT</div>
            <code style={{ display: 'block', marginTop: '6px', color: '#D9D9D9', overflowWrap: 'anywhere' }}>{endpoint}</code>
          </div>
          <div>
            <div style={head}>AUTHORIZATION</div>
            <code style={{ display: 'block', marginTop: '6px', color: '#FFB829', overflowWrap: 'anywhere', userSelect: 'all' }}>Bearer {issued.capability}</code>
          </div>
          <div>
            <div style={head}>EXPIRES</div>
            <time dateTime={issued.expiresAt} style={{ display: 'block', marginTop: '6px', color: '#BDBDBD', fontSize: '12px' }}>
              {at(issued.expiresAt)} · 30 DAYS AFTER ISSUE
            </time>
          </div>
          <pre style={{ margin: 0, padding: '12px', border: '1px solid rgba(255,255,255,0.10)', overflowX: 'auto', whiteSpace: 'pre-wrap', color: '#9A9A9A', fontFamily: MONO, fontSize: '10.5px', lineHeight: 1.55 }}>{`Authorization: Bearer ${issued.capability}\nContent-Type: application/json`}</pre>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <button type="button" onClick={() => { void copy(); }} style={{ border: '1px solid rgba(255,255,255,0.18)', borderRadius: '7px', padding: '9px 12px', background: 'transparent', color: '#FFFFFF', cursor: 'pointer' }}>COPY CAPABILITY</button>
            <button type="button" disabled={busy} onClick={() => { void revoke(); }} style={{ border: '1px solid rgba(255,184,41,0.45)', borderRadius: '7px', padding: '9px 12px', background: 'transparent', color: '#FFB829', cursor: busy ? 'wait' : 'pointer' }}>{busy ? 'REVOKING…' : 'REVOKE'}</button>
          </div>
        </div>
      )}
      {problem === null ? null : <p role="status" style={{ margin: '12px 0 0', color: problem.startsWith('Capability copied') || problem.startsWith('Capability revoked') ? '#B79BFF' : '#FFB829', fontSize: '12px' }}>{problem}</p>}
    </section>
  );
}

export function Tools() {
  const tools = useScoped<readonly RegisteredToolRecord[]>('tools');
  const rows = tools.state === 'ready' ? tools.value : [];

  return (
    <div style={{ maxWidth: '1040px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <div style={{ ...head, paddingBottom: '7px' }}>RUNTIME TOOL REGISTRY</div>
        <p style={{ fontSize: '15px', lineHeight: 1.65, color: '#BDBDBD', margin: 0, maxWidth: '76ch' }}>
          This registry lists only code paths the Agent Runtime can invoke. Availability means the
          implementation is present. Last verified means a persisted run completed the call.
        </p>
      </div>

      <section aria-labelledby="surface-coverage" style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', padding: '16px', overflowX: 'auto' }}>
        <div id="surface-coverage" style={{ ...head, paddingBottom: '7px', color: '#B79BFF' }}>IMPLEMENTED SURFACE COVERAGE</div>
        <p style={{ fontSize: '13px', color: '#9A9A9A', lineHeight: 1.6, margin: '0 0 13px', maxWidth: '78ch' }}>
          Canonical memory reads are shared. Governed run control is currently an HTTP product capability; the CLI and MCP do not expose run launch, cancel, retry, or schedule control.
        </p>
        <table aria-label="Agent capability by client" style={{ minWidth: '660px', width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: '12px' }}>
          <thead>
            <tr>
              {['CLIENT', 'RESOLVED MEMORY', 'CONTEXT PACK / EVIDENCE', 'AGENT RUN CONTROL'].map((cell) => (
                <th key={cell} scope="col" style={{ padding: '9px 8px', borderTop: '1px solid rgba(255,255,255,0.09)', textAlign: 'left', fontFamily: MONO, fontWeight: 400, letterSpacing: '0.1em', color: '#7A7A7A' }}>{cell}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ['WEB + HTTP', 'YES', 'YES', 'LAUNCH · CANCEL · RETRY · SCHEDULE'],
              ['CLI', 'YES', 'CLAIM + EVIDENCE ENVELOPE', 'NOT EXPOSED'],
              ['MCP', 'YES', 'CLAIM + EVIDENCE ENVELOPE', 'NOT EXPOSED'],
              ['PACKAGED SDK', 'NOT SHIPPED', 'NOT SHIPPED', 'NOT SHIPPED'],
            ].map((row) => (
              <tr key={row[0]}>
                {row.map((cell, cellIndex) => {
                  const style = { padding: '9px 8px', borderTop: '1px solid rgba(255,255,255,0.09)', textAlign: 'left' as const, fontFamily: cellIndex === 0 ? MONO : 'inherit', fontWeight: 400, letterSpacing: cellIndex === 0 ? '0.1em' : 'normal', color: cell === 'NOT EXPOSED' || cell === 'NOT SHIPPED' ? '#FFB829' : '#BDBDBD' };
                  return cellIndex === 0
                    ? <th key={cell} scope="row" style={style}>{cell}</th>
                    : <td key={`${row[0]}-${cellIndex}`} style={style}>{cell}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <McpAccess />

      {tools.state === 'loading' ? <Stage label="LOADING TOOL REGISTRY" /> : null}
      {tools.state === 'failed' ? <Failed reason={tools.reason} /> : null}
      {tools.state === 'ready' && rows.length === 0 ? (
        <Empty headline="No agent tools are registered." detail="Nothing will be shown here until the runtime exposes an implemented tool." />
      ) : null}

      {rows.map((tool) => (
        <article key={`${tool.name}@${tool.version}`} style={{ borderTop: '1px solid rgba(255,255,255,0.14)', paddingTop: '18px', display: 'flex', flexDirection: 'column', gap: '13px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '20px', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontFamily: MONO, fontSize: '14px', color: '#FFFFFF' }}>{tool.name}</div>
              <div style={{ ...note, marginTop: '6px' }}>VERSION {tool.version} · {tool.source}</div>
            </div>
            <div style={{ ...note, color: '#B79BFF', border: '1px solid rgba(128,82,255,0.45)', padding: '7px 9px' }}>{tool.health}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '130px minmax(0, 1fr)', gap: '9px 18px', fontSize: '12.5px' }}>
            <span style={head}>ACCESS</span><span style={{ color: '#BDBDBD' }}>{tool.access}</span>
            <span style={head}>PERMISSIONS</span><span style={{ color: '#BDBDBD' }}>{tool.permissions.join(', ') || 'NONE'}</span>
            <span style={head}>SIDE EFFECT</span><span style={{ color: '#BDBDBD' }}>{tool.sideEffect}</span>
            <span style={head}>LAST VERIFIED</span><span style={{ ...note, letterSpacing: '0.08em' }}>{at(tool.lastVerifiedAt)}</span>
          </div>
          <details>
            <summary style={{ ...head, cursor: 'pointer', padding: '7px 0' }}>INPUT / OUTPUT SCHEMA</summary>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: '14px', paddingTop: '10px' }}>
              <div>
                <div style={{ ...head, paddingBottom: '7px' }}>INPUT</div>
                <pre style={{ margin: 0, padding: '12px', border: '1px solid rgba(255,255,255,0.10)', overflowX: 'auto', whiteSpace: 'pre-wrap', color: '#9A9A9A', fontFamily: MONO, fontSize: '10.5px', lineHeight: 1.55 }}>{JSON.stringify(tool.inputSchema, null, 2)}</pre>
              </div>
              <div>
                <div style={{ ...head, paddingBottom: '7px' }}>OUTPUT</div>
                <pre style={{ margin: 0, padding: '12px', border: '1px solid rgba(255,255,255,0.10)', overflowX: 'auto', whiteSpace: 'pre-wrap', color: '#9A9A9A', fontFamily: MONO, fontSize: '10.5px', lineHeight: 1.55 }}>{JSON.stringify(tool.outputSchema, null, 2)}</pre>
              </div>
            </div>
          </details>
        </article>
      ))}
    </div>
  );
}
