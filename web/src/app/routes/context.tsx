import { useState } from 'react';

import { useScoped } from '../../api/scope';
import { MONO } from '../../design/mark';
import { Empty, Failed, Panel, Stage } from '../state';
import { Extractor } from './extractor';

/**
 * The CONTEXT group: Memory, Timeline, Graph and Context health.
 *
 * All four read the workspace. The design draws them with the demo corpus in
 * them; here the rows are whatever the workspace holds, which for a new
 * account is nothing. The graph keeps its fixed layout and no physics, so the
 * same claims draw the same picture every time.
 */

interface MemoryRow {
  readonly claim: string;
  readonly entity: string;
  readonly src: string;
  readonly obs: string;
  readonly st: 'CUR' | 'SUP' | 'PRO' | 'CON' | 'UN';
}

interface MemoryPage {
  readonly rows: readonly MemoryRow[];
  readonly total: number;
  readonly demo: boolean;
}

interface Category { readonly l: string; readonly n: number; readonly col: string }

const FILTERS = ['ALL', 'CURRENT', 'HISTORICAL', 'PROPOSAL', 'CONFLICTED', 'UNSUPPORTED'] as const;
const FILTER_STATE: Readonly<Record<string, MemoryRow['st']>> = {
  CURRENT: 'CUR', HISTORICAL: 'SUP', PROPOSAL: 'PRO', CONFLICTED: 'CON', UNSUPPORTED: 'UN',
};

const STATE_LABEL: Readonly<Record<MemoryRow['st'], string>> = {
  CUR: 'CURRENT', SUP: 'HISTORICAL', PRO: 'PROPOSAL', CON: 'CONTRADICTED', UN: 'UNSUPPORTED',
};
const STATE_COLOUR: Readonly<Record<MemoryRow['st'], string>> = {
  CUR: '#8052FF', CON: '#BDBDBD', SUP: '#71717A', PRO: '#71717A', UN: '#71717A',
};

const GRID = '22px 1.8fr 0.7fr 1fr 0.7fr 1fr';
const head = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#5E5E5E' } as const;
const note = { fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.16em', color: '#5E5E5E' } as const;

/** The design's five state glyphs. Shape carries the state, never colour alone. */
function StateMark({ st }: { st: MemoryRow['st'] }) {
  if (st === 'CUR') return <svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="3.2" fill="#8052FF" /></svg>;
  if (st === 'SUP') return <svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="3" fill="none" stroke="#71717A" strokeWidth="1.2" /></svg>;
  if (st === 'PRO') return <svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="3" fill="none" stroke="#71717A" strokeWidth="1.2" strokeDasharray="2 2" /></svg>;
  if (st === 'CON') return <svg width="10" height="10" viewBox="0 0 10 10"><path d="M5 9V5.5M5 5.5L2 1.5M5 5.5L8 1.5" fill="none" stroke="#BDBDBD" strokeWidth="1.2" /></svg>;
  return <svg width="10" height="10" viewBox="0 0 10 10"><path d="M8 5A3 3 0 1 1 5 2" fill="none" stroke="#9A9A9A" strokeWidth="1.2" /></svg>;
}

export function Memory() {
  const page = useScoped<MemoryPage>('memory');
  const [filter, setFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');

  const rows = page.state === 'ready' ? page.value.rows : [];
  const shown = rows.filter((r) => {
    if (filter !== 'ALL' && r.st !== FILTER_STATE[filter]) return false;
    if (search.trim() === '') return true;
    return r.claim.toLowerCase().includes(search.trim().toLowerCase());
  });

  return (
    <div style={{ maxWidth: '1220px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="fv-violet" type="text" placeholder="Search claims" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: '200px', background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '8px', padding: '10px 14px', color: '#FFFFFF', fontFamily: MONO, fontSize: '12px', outline: 'none' }} />
        {FILTERS.map((l) => (
          <button key={l} className="hv-text" onClick={() => setFilter(l)} style={{ background: 'none', cursor: 'pointer', borderRadius: '7px', padding: '7px 11px', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.12em', border: '1px solid rgba(255,255,255,0.12)', color: filter === l ? '#FFFFFF' : '#9A9A9A' }}>{l}</button>
        ))}
      </div>
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: '14px', padding: '8px 4px', borderBottom: '1px solid rgba(255,255,255,0.14)', ...head }}>
          <span></span><span>CLAIM</span><span>SCOPE</span><span>SOURCE</span><span>OBSERVED</span><span>STATE</span>
        </div>
        {page.state === 'loading' ? <Stage label="RETRIEVING" /> : null}
        {page.state === 'failed' ? <Failed reason={page.reason} /> : null}
        {page.state === 'ready' && shown.length === 0 ? (
          <Empty headline={rows.length === 0 ? 'No claims yet.' : 'Nothing matches that filter.'} detail={rows.length === 0 ? 'Claims appear once a source has been ingested into this workspace.' : 'Clear the search or pick a different state.'} />
        ) : null}
        {shown.map((r) => (
          <div key={`${r.entity}-${r.claim}-${r.obs}`} className="hv-surface3" style={{ display: 'grid', gridTemplateColumns: GRID, gap: '14px', alignItems: 'baseline', padding: '13px 4px', borderBottom: '1px solid rgba(255,255,255,0.07)', opacity: r.st === 'SUP' || r.st === 'PRO' ? 0.55 : 1, transition: 'background 140ms ease, opacity 200ms ease' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', height: '14px' }}><StateMark st={r.st} /></span>
            <span style={{ fontSize: '14.5px', color: '#FFFFFF' }}>{r.claim}</span>
            <span style={{ fontFamily: MONO, fontSize: '11px', color: '#9A9A9A' }}>{r.entity}</span>
            <span style={{ fontSize: '13px', color: '#BDBDBD' }}>{r.src}</span>
            <span style={{ fontFamily: MONO, fontSize: '11px', color: '#9A9A9A' }}>{r.obs}</span>
            <span style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.12em', color: STATE_COLOUR[r.st] }}>{STATE_LABEL[r.st]}</span>
          </div>
        ))}
        {page.state === 'ready' && rows.length > 0 ? (
          <div style={{ padding: '12px 4px', ...note }}>
            {shown.length} OF {page.value.total} CLAIMS{page.value.demo ? ' · SAMPLE WORKSPACE' : ''}
          </div>
        ) : null}
      </div>
      <Extractor />
    </div>
  );
}

interface Change { readonly t: string; readonly d: string }
interface Conflict { readonly t: string; readonly state: string }

export function Timeline() {
  const changes = useScoped<readonly Change[]>('changes');
  const conflicts = useScoped<readonly Conflict[]>('conflicts');

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '38px' }}>
      <div>
        <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#9A9A9A' }}>WHAT CHANGED</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap', marginTop: '18px' }}>
          <Panel loaded={changes} stage="RETRIEVING" empty={{ headline: 'Nothing has changed yet.', detail: 'A revision appears when a newer source replaces something this workspace already held.' }}>
            {(rows) => rows.map((c, i) => (
              <span key={c.t} style={{ display: 'flex', alignItems: 'center' }}>
                {i > 0 ? <span style={{ width: '38px', height: '1px', background: 'rgba(255,255,255,0.18)', margin: '0 2px' }}></span> : null}
                <span style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', padding: '14px 20px', display: 'block' }}>
                  <span style={{ fontSize: '19px', color: '#9A9A9A', display: 'block' }}>{c.t}</span>
                  <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.16em', color: '#5E5E5E', marginTop: '6px', display: 'block' }}>{c.d} · HISTORICAL</span>
                </span>
              </span>
            ))}
          </Panel>
        </div>
      </div>
      <div>
        <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#BDBDBD' }}>UNRESOLVED</span>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '16px' }}>
          <Panel loaded={conflicts} stage="CHECKING CURRENT STATE" empty={{ headline: 'No unresolved conflicts.', detail: 'A conflict stays here until evidence or an explicit policy resolves it.' }}>
            {(rows) => rows.map((c) => (
              <div key={c.t} style={{ border: '1px dashed rgba(255,255,255,0.22)', borderRadius: '10px', padding: '14px 20px', flex: 1, minWidth: '240px' }}>
                <div style={{ fontSize: '17px', color: '#FFFFFF' }}>{c.t}</div>
                <div style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.16em', color: '#5E5E5E', marginTop: '6px' }}>{c.state}</div>
              </div>
            ))}
          </Panel>
        </div>
        <p style={{ fontSize: '14px', color: '#9A9A9A', margin: '14px 0 0' }}>Neither wins. Both stay visible until evidence or policy resolves the conflict.</p>
      </div>
    </div>
  );
}

/**
 * The graph, drawn as a fixed layered diagram: query on the left, claims, then
 * evidence, then sources. No physics and no randomness, so the same claims
 * produce the same picture every time. The list underneath is the same graph
 * for anyone who cannot use the picture.
 */
export function Graph() {
  const page = useScoped<MemoryPage>('memory');
  const rows = page.state === 'ready' ? page.value.rows.slice(0, 6) : [];

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {page.state === 'loading' ? <Stage label="RETRIEVING" /> : null}
      {page.state === 'failed' ? <Failed reason={page.reason} /> : null}
      {page.state === 'ready' && rows.length === 0 ? (
        <Empty headline="Nothing to draw yet." detail="The graph shows claims, the evidence behind them and where that evidence came from." />
      ) : null}
      {rows.length > 0 ? (
        <>
          <svg viewBox={`0 0 960 ${Math.max(200, 60 + rows.length * 62)}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Claims, their evidence and their sources">
            <text x="70" y="30" fill="#5E5E5E" fontSize="10" letterSpacing="3" fontFamily="JetBrains Mono, monospace">QUERY</text>
            <text x="330" y="30" fill="#5E5E5E" fontSize="10" letterSpacing="3" fontFamily="JetBrains Mono, monospace">CLAIMS</text>
            <text x="610" y="30" fill="#5E5E5E" fontSize="10" letterSpacing="3" fontFamily="JetBrains Mono, monospace">EVIDENCE</text>
            <text x="840" y="30" fill="#5E5E5E" fontSize="10" letterSpacing="3" fontFamily="JetBrains Mono, monospace">SOURCES</text>
            {rows.map((r, i) => {
              const y = 70 + i * 62;
              const current = r.st === 'CUR';
              const stroke = current ? '#8052FF' : 'rgba(255,255,255,0.18)';
              return (
                <g key={`${r.entity}-${r.claim}`}>
                  <line x1="185" y1={y + 22} x2="320" y2={y + 22} stroke={stroke} strokeWidth={current ? 1.4 : 1} strokeDasharray={current ? undefined : '4 4'} />
                  <line x1="470" y1={y + 22} x2="600" y2={y + 22} stroke={stroke} strokeWidth={current ? 1.4 : 1} strokeDasharray={current ? undefined : '4 4'} />
                  <line x1="750" y1={y + 22} x2="830" y2={y + 22} stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
                  <rect x="320" y={y} width="150" height="44" rx="8" fill="none" stroke={stroke} strokeWidth={current ? 1.4 : 1} strokeDasharray={current ? undefined : '4 4'} />
                  <text x="338" y={y + 20} fill={current ? '#FFFFFF' : '#9A9A9A'} fontSize="13" fontFamily="Space Grotesk, sans-serif">{r.claim.slice(0, 18)}</text>
                  <text x="338" y={y + 36} fill={current ? '#8052FF' : '#5E5E5E'} fontSize="9" letterSpacing="2" fontFamily="JetBrains Mono, monospace">{STATE_LABEL[r.st]}</text>
                  <rect x="600" y={y} width="150" height="44" rx="8" fill="none" stroke="rgba(255,255,255,0.3)" />
                  <circle cx="608" cy={y + 22} r="2.5" fill="#FFB829" />
                  <text x="618" y={y + 26} fill="#BDBDBD" fontSize="12" fontFamily="Space Grotesk, sans-serif">{r.src.slice(0, 16)}</text>
                  <text x="838" y={y + 26} fill="#9A9A9A" fontSize="11" fontFamily="JetBrains Mono, monospace">{r.entity.slice(0, 12)}</text>
                </g>
              );
            })}
            <rect x="60" y="70" width="125" height="44" rx="8" fill="none" stroke="rgba(255,255,255,0.3)" />
            <text x="74" y="90" fill="#FFFFFF" fontSize="12" fontFamily="Space Grotesk, sans-serif">This workspace</text>
            <text x="74" y="105" fill="#9A9A9A" fontSize="10" fontFamily="JetBrains Mono, monospace">{rows.length} shown</text>
          </svg>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {rows.map((r) => (
              <li key={`list-${r.entity}-${r.claim}`} style={{ fontSize: '13px', color: '#9A9A9A' }}>
                <span style={{ color: '#FFFFFF' }}>{r.claim}</span> · {STATE_LABEL[r.st]} · evidence from {r.src} · scope {r.entity}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <span style={note}>FIXED LAYOUT · NO PHYSICS · SAME GRAPH EVERY TIME</span>
    </div>
  );
}

export function Health() {
  const cats = useScoped<readonly Category[]>('categories');
  const [selected, setSelected] = useState(-1);
  const rows = cats.state === 'ready' ? cats.value : [];
  const total = rows.reduce((sum, c) => sum + c.n, 0);

  return (
    <div style={{ maxWidth: '1220px', margin: '0 auto', display: 'flex', gap: 'clamp(24px, 4vw, 60px)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <svg viewBox="0 0 400 400" style={{ width: 'min(400px, 100%)', aspectRatio: '1', flexShrink: 0 }} role="img" aria-label="Every claim in this workspace, placed by state">
        {rows.length === 0 ? null : rows.map((c, ci) => {
          const before = rows.slice(0, ci).reduce((sum, r) => sum + r.n, 0);
          return Array.from({ length: Math.min(c.n, 240) }, (_ignored, i) => {
            const index = before + i;
            const t = total === 0 ? 0 : index / total;
            const angle = t * Math.PI * 6.2;
            const radius = 24 + t * 150;
            const dim = selected >= 0 && selected !== ci;
            return (
              <circle
                key={`${c.l}-${i}`}
                cx={200 + Math.cos(angle) * radius}
                cy={200 + Math.sin(angle) * radius}
                r={c.col === '#8052FF' ? 2.2 : 1.7}
                fill={c.col}
                opacity={dim ? 0.12 : 0.85}
              />
            );
          });
        })}
      </svg>
      <div style={{ flex: 1, minWidth: '280px', maxWidth: '520px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <p style={{ fontSize: '15px', lineHeight: 1.7, color: '#9A9A9A', margin: '0 0 12px' }}>Not one score. The spiral is the memory itself: every fragment placed by age, coloured by state. Select a category to isolate it.</p>
        {cats.state === 'loading' ? <Stage label="CHECKING CONTEXT" /> : null}
        {cats.state === 'failed' ? <Failed reason={cats.reason} /> : null}
        {cats.state === 'ready' && rows.length === 0 ? (
          <Empty headline="Nothing to measure yet." detail="Context health describes the claims in a workspace. This one has none." />
        ) : null}
        {rows.map((c, i) => (
          <button key={c.l} className="hv-surface3" onClick={() => setSelected(selected === i ? -1 : i)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', background: 'none', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', padding: '11px 4px', textAlign: 'left' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
              <span style={{ width: '8px', height: '8px', background: c.col }}></span>
              <span style={{ fontSize: '14px', color: selected === i ? '#FFFFFF' : '#BDBDBD' }}>{c.l}</span>
            </span>
            <span style={{ fontFamily: MONO, fontSize: '12px', color: '#9A9A9A' }}>{c.n}</span>
          </button>
        ))}
        <span style={{ ...note, marginTop: '12px' }}>NO SINGLE SCORE</span>
      </div>
    </div>
  );
}
