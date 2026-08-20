import { useScoped } from '../../api/scope';
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
