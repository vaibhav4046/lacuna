import { useEffect, useState } from 'react';
import { MONO } from '../design/mark';
import { icStyle } from '../design/icons';
import { CONNECTOR_PRESENTATION, dotFor } from '../design/connectors';

const POSITIONS = {
  CODE: ['22%', '42%'], WORK: ['76%', '40%'], FILES: ['24%', '74%'], DATA: ['76%', '74%'],
} as const;

interface PublicConnectorState {
  readonly id: string;
  readonly availability: 'available' | 'unavailable';
}

interface PublicConnectorSnapshot {
  readonly phase: 'checking' | 'ready' | 'unknown';
  readonly byId: Readonly<Record<string, PublicConnectorState>>;
}

function usePublicConnectorState(): PublicConnectorSnapshot {
  const [snapshot, setSnapshot] = useState<PublicConnectorSnapshot>({ phase: 'checking', byId: {} });
  useEffect(() => {
    let active = true;
    void fetch('/api/explore/connectors', { headers: { Accept: 'application/json' } })
      .then((response) => response.ok ? response.json() as Promise<{ connectors?: readonly PublicConnectorState[] }> : null)
      .then((body) => {
        if (!active || body === null || !Array.isArray(body.connectors)) {
          if (active) setSnapshot({ phase: 'unknown', byId: {} });
          return;
        }
        const next: Record<string, PublicConnectorState> = {};
        for (const connector of body.connectors) {
          if (typeof connector?.id !== 'string'
            || (connector.availability !== 'available' && connector.availability !== 'unavailable')) continue;
          next[connector.id] = connector;
        }
        setSnapshot({ phase: 'ready', byId: next });
      })
      .catch(() => { if (active) setSnapshot({ phase: 'unknown', byId: {} }); });
    return () => { active = false; };
  }, []);
  return snapshot;
}

export function Conn() {
  const publicState = usePublicConnectorState();
  return (
    <section id="conn" data-scene="conn" style={{ position: 'relative', height: '200vh' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 'max(9%, 92px)', left: 0, right: 0, textAlign: 'center', padding: '0 20px' }}>
          <h2 style={{ fontSize: 'clamp(36px, 4.2vw, 70px)', fontWeight: 400, lineHeight: 1.02, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>Bring the context you already have.</h2>
          <span style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.18em', color: '#7A7A7A', display: 'block', marginTop: '14px' }}>IMPLEMENTED CAPABILITY IS NOT A RUNTIME AVAILABILITY CLAIM · PLANNED ITEMS STAY INERT</span>
        </div>
        {(Object.keys(POSITIONS) as readonly (keyof typeof POSITIONS)[]).map((group) => {
          const [left, top] = POSITIONS[group];
          return <div key={group} data-mhide="1" data-shield style={{ position: 'absolute', left, top, transform: 'translate(-50%,-50%)', width: '190px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontFamily: MONO, fontSize: '9.5px', fontWeight: 500, letterSpacing: '0.24em', color: '#7A7A84' }}>{group}</span>
            {CONNECTOR_PRESENTATION.filter((item) => item.group === group).slice(0, 4).map((item) => {
              const runtime = item.serverIds.map((id) => publicState.byId[id]).find((entry) => entry !== undefined);
              const status = item.implementation === 'planned' ? 'PLANNED'
                : runtime === undefined && publicState.phase === 'checking' ? 'CHECKING'
                  : runtime === undefined ? 'UNKNOWN'
                  : runtime.availability === 'available' ? 'AVAILABLE' : 'UNAVAILABLE';
              const dot = item.implementation === 'planned' ? 'planned'
                : runtime === undefined ? publicState.phase === 'unknown' ? 'unavailable' : 'planned' : runtime.availability;
              return <span key={item.key} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={icStyle(item.name, 13)} />
                <span style={{ fontSize: '13.5px', color: '#BDBDBD' }}>{item.name}</span>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: dotFor(dot), flexShrink: 0 }} aria-hidden="true" />
                <span style={{ minWidth: '76px', fontFamily: MONO, fontSize: '8.5px', letterSpacing: '0.1em', color: '#7A7A7A', whiteSpace: 'nowrap' }}>{status}</span>
              </span>;
            })}
          </div>;
        })}
      </div>
    </section>
  );
}
