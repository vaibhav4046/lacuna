import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MemoryFieldEngine } from './engine';
import type { EngineState } from './engine';
import { MONO } from '../design/mark';
import { overviewLayout } from '../graph/layout';
import { STATE_COLOUR, STATE_LABEL, type GraphEnvelope, type GraphNode, type GraphNodeState } from '../graph/types';

/**
 * The constellation canvas, and the one place the engine is driven from.
 *
 * In the design this element sits at the document root, outside every view
 * branch, so it mounts once and survives every navigation. Same here: it is
 * rendered above the router, never inside a route, which is what lets the
 * particle state persist while the page under it changes. The engine hides the
 * canvas itself when the view is the signed-in application, because a field
 * drifting behind a table is decoration rather than explanation.
 *
 * The engine keeps its own mutable state object rather than receiving props on
 * every frame. That is not a shortcut: it runs at sixty frames a second off a
 * requestAnimationFrame loop, and a React render per frame would be a second
 * scheduler fighting the first one.
 */

/** The design's own view names, derived from the URL rather than from state. */
function viewFor(pathname: string): EngineState['view'] {
  if (pathname === '/signin') return 'signin';
  if (pathname === '/signup') return 'signup';
  if (pathname === '/forgot') return 'forgot';
  if (pathname === '/onboarding') return 'onboard';
  if (pathname.startsWith('/app')) return 'app';
  return 'landing';
}

export function MemoryField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<MemoryFieldEngine | null>(null);
  const location = useLocation();
  const view = viewFor(location.pathname);

  useEffect(() => {
    const engine = new MemoryFieldEngine(canvasRef, {
      state: { view: viewFor(window.location.pathname), route: 'dash', obStep: 0, healthSel: -1, hoverRev: -1 },
    });
    engineRef.current = engine;
    try {
      engine.mount();
    } catch (error) {
      // A field that fails to start is a page without a field, not a page
      // without a product. The rest of the landing is real text and it renders.
      console.error('lacuna: the memory field did not start', error);
    }
    return () => {
      engineRef.current = null;
      engine.unmount();
    };
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    if (engine === null) return;
    const previous = { view: engine.state.view };
    engine.state.view = view;
    engine.changed(engine.props, previous);
  }, [view]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 0,
        pointerEvents: 'none',
        display: 'block',
      }}
    />
  );
}

const OVERVIEW_STATES: readonly ('all' | GraphNodeState)[] = [
  'all', 'current', 'historical', 'conflicted', 'missing', 'withdrawn', 'neutral',
];

function nodeShape(node: GraphNode, selected: boolean) {
  const colour = STATE_COLOUR[node.state];
  if (node.kind === 'evidence') {
    return <circle r={selected ? 5 : 3.2} fill={colour} opacity={node.state === 'historical' ? 0.55 : 0.95} />;
  }
  if (node.state === 'missing') {
    return <circle r={selected ? 12 : 9} fill="#09090D" stroke={colour} strokeWidth="1.4" strokeDasharray="4 3" />;
  }
  if (node.state === 'conflicted') {
    return <path d="M0 10V1M0 1L-7-8M0 1L7-8" fill="none" stroke={colour} strokeWidth={selected ? 2.4 : 1.7} />;
  }
  if (node.state === 'historical' || node.state === 'withdrawn') {
    return <circle r={selected ? 10 : 7.5} fill="#09090D" stroke={colour} strokeWidth={selected ? 2.2 : 1.25} />;
  }
  if (node.kind === 'context_pack') {
    return <path d="M-10-7H4L10 0 4 7H-10L-5 0Z" fill="rgba(138,100,255,0.18)" stroke={colour} strokeWidth={selected ? 2.2 : 1.4} />;
  }
  return <circle r={selected ? 10 : 7} fill={colour} stroke="#09090D" strokeWidth="2" />;
}

function nextListButton(event: KeyboardEvent<HTMLButtonElement>, direction: 1 | -1): void {
  const item = event.currentTarget.closest('li');
  const sibling = direction === 1 ? item?.nextElementSibling : item?.previousElementSibling;
  const button = sibling?.querySelector('button');
  if (button instanceof HTMLButtonElement) {
    event.preventDefault();
    button.focus();
  }
}

interface MemoryFieldOverviewProps {
  readonly graph: GraphEnvelope;
  readonly prefix: string;
  readonly loadingMore: boolean;
  readonly moreFailed: boolean;
  readonly onLoadMore: () => void;
}

/**
 * A navigational memory field. Its spiral encodes state bands, never an
 * evidence path. Exact paths are rendered by ProofGraph instead.
 */
export function MemoryFieldOverview({ graph, prefix, loadingMore, moreFailed, onLoadMore }: MemoryFieldOverviewProps) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<'all' | GraphNodeState>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });

  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return graph.nodes.filter((node) => (
      (state === 'all' || node.state === state)
      && (needle === '' || `${node.label} ${node.detail ?? ''} ${node.sourceRef ?? ''}`.toLocaleLowerCase().includes(needle))
    ));
  }, [graph.nodes, query, state]);
  const placed = useMemo(() => overviewLayout(shown), [shown]);
  const active = graph.nodes.find((node) => node.id === (hovered ?? selected)) ?? null;
  const selectedNode = graph.nodes.find((node) => node.id === selected) ?? null;
  const adjacent = useMemo(() => {
    if (selected === null) return new Set<string>();
    return new Set(graph.edges.flatMap((edge) => edge.from === selected
      ? [edge.to]
      : edge.to === selected ? [edge.from] : []));
  }, [graph.edges, selected]);
  const viewWidth = 1_000 / camera.zoom;
  const viewHeight = 620 / camera.zoom;
  const viewX = (1_000 - viewWidth) / 2 + camera.x;
  const viewY = (620 - viewHeight) / 2 + camera.y;
  const focusPack = () => {
    const pack = graph.nodes.find((node) => node.kind === 'context_pack');
    if (pack !== undefined) setSelected(pack.id);
  };
  const openSource = () => {
    if (selectedNode?.sourceRef === null || selectedNode === null) return;
    const source = graph.nodes.find((node) => node.kind === 'source' && node.label === selectedNode.sourceRef);
    if (source !== undefined) setSelected(source.id);
  };

  return (
    <section aria-labelledby="memory-field-heading" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', gap: '18px', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ maxWidth: '66ch' }}>
          <div id="memory-field-heading" style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#B9AED8' }}>MEMORY FIELD OVERVIEW · NAVIGATION</div>
          <p style={{ margin: '8px 0 0', color: '#9A9A9A', fontSize: '14px', lineHeight: 1.65 }}>
            State shapes the field: current claims stay near the opening, history moves outward, conflicts split, and missing evidence leaves the centre open. Position is for navigation. It is not proof of topology.
          </p>
        </div>
        <div style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.14em', color: '#918B9F', textAlign: 'right' }}>
          {shown.length} VISIBLE · {graph.nodes.length} LOADED · {graph.page.totalNodes} TOTAL
          {graph.page.truncated ? <><br />SERVER CAP APPLIED</> : null}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ flex: '1 1 260px' }}>
          <span style={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Search the memory field</span>
          <input className="fv-violet" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search entities, claims or sources" style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(8,8,12,0.68)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '7px', padding: '10px 12px', color: '#FFFFFF', fontFamily: MONO, fontSize: '11px', outline: 'none' }} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: MONO, fontSize: '10px', color: '#817B8E' }}>
          STATE
          <select value={state} onChange={(event) => setState(event.target.value as 'all' | GraphNodeState)} style={{ background: '#101017', color: '#D8D4E2', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '7px', padding: '9px 10px', fontFamily: MONO, fontSize: '10px' }}>
            {OVERVIEW_STATES.map((option) => <option key={option} value={option}>{option === 'all' ? 'All states' : STATE_LABEL[option]}</option>)}
          </select>
        </label>
        <button onClick={focusPack} disabled={!graph.nodes.some((node) => node.kind === 'context_pack')} style={{ background: 'transparent', border: '1px solid rgba(138,100,255,0.38)', color: '#B9AED8', borderRadius: '7px', padding: '9px 11px', fontFamily: MONO, fontSize: '10px', cursor: 'pointer' }}>FOCUS CONTEXT PACK</button>
      </div>

      <div style={{ display: 'flex', gap: '16px', alignItems: 'stretch', flexWrap: 'wrap' }}>
        <div style={{ flex: '2 1 620px', minWidth: 0, border: '1px solid rgba(255,255,255,0.10)', borderRadius: '12px', background: 'radial-gradient(circle at 50% 47%, rgba(128,82,255,0.055), rgba(7,7,11,0.82) 62%)', overflow: 'hidden', position: 'relative' }}>
          <div role="group" aria-label="Pan and zoom" style={{ position: 'absolute', zIndex: 2, top: '10px', right: '10px', display: 'grid', gridTemplateColumns: 'repeat(3, 30px)', gap: '4px' }}>
            <span></span><button aria-label="Pan up" onClick={() => setCamera((it) => ({ ...it, y: it.y - 36 / it.zoom }))} style={cameraButton}>↑</button><span></span>
            <button aria-label="Pan left" onClick={() => setCamera((it) => ({ ...it, x: it.x - 36 / it.zoom }))} style={cameraButton}>←</button>
            <button aria-label="Reset view" onClick={() => setCamera({ x: 0, y: 0, zoom: 1 })} style={cameraButton}>•</button>
            <button aria-label="Pan right" onClick={() => setCamera((it) => ({ ...it, x: it.x + 36 / it.zoom }))} style={cameraButton}>→</button>
            <button aria-label="Zoom out" onClick={() => setCamera((it) => ({ ...it, zoom: Math.max(0.7, Number((it.zoom - 0.2).toFixed(1))) }))} style={cameraButton}>−</button>
            <button aria-label="Pan down" onClick={() => setCamera((it) => ({ ...it, y: it.y + 36 / it.zoom }))} style={cameraButton}>↓</button>
            <button aria-label="Zoom in" onClick={() => setCamera((it) => ({ ...it, zoom: Math.min(2.4, Number((it.zoom + 0.2).toFixed(1))) }))} style={cameraButton}>+</button>
          </div>
          {shown.length === 0 ? (
            <div style={{ minHeight: '420px', display: 'grid', placeItems: 'center', color: '#817B8E', fontSize: '14px', padding: '30px', textAlign: 'center' }}>No nodes match this search and state. Clear the search or choose another state.</div>
          ) : (
            <svg viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`} role="group" aria-label="Navigational memory field grouped by state" style={{ width: '100%', minHeight: '440px', display: 'block', touchAction: 'none' }}>
              <circle cx="500" cy="310" r="49" fill="none" stroke="rgba(213,208,232,0.32)" strokeWidth="1" strokeDasharray="5 7" />
              <path d="M520 267 A48 48 0 0 1 548 310" fill="none" stroke="#09090D" strokeWidth="9" />
              <text x="500" y="306" textAnchor="middle" fill="#8D8798" fontFamily="JetBrains Mono, monospace" fontSize="9" letterSpacing="1.8">OPEN</text>
              <text x="500" y="320" textAnchor="middle" fill="#6D6878" fontFamily="JetBrains Mono, monospace" fontSize="8">MISSING STAYS MISSING</text>
              <ellipse cx="500" cy="310" rx="294" ry="235" fill="none" stroke="rgba(98,98,115,0.19)" strokeWidth="1" strokeDasharray="3 8" />
              {placed.map((node) => {
                const isSelected = node.id === selected;
                const dim = selected !== null && !isSelected && !adjacent.has(node.id);
                return (
                  <g key={node.id} transform={`translate(${node.x} ${node.y})`} role="button" tabIndex={0} aria-label={`${node.kind}: ${node.label}. ${STATE_LABEL[node.state]}`} aria-pressed={isSelected} onClick={() => setSelected(node.id)} onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelected(node.id);
                    }
                  }} onMouseEnter={() => setHovered(node.id)} onMouseLeave={() => setHovered(null)} style={{ cursor: 'pointer', opacity: dim ? 0.18 : 1, transition: 'opacity 140ms ease' }}>
                    {isSelected ? <circle r="15" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="1" /> : null}
                    {nodeShape(node, isSelected)}
                    {(node.kind === 'entity' || node.kind === 'context_pack') ? <text x="13" y="4" fill={isSelected ? '#FFFFFF' : '#B3AFC0'} fontFamily="Space Grotesk, sans-serif" fontSize="10">{node.label.slice(0, 28)}</text> : null}
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        <aside style={{ flex: '1 1 280px', minWidth: 0, border: '1px solid rgba(255,255,255,0.10)', borderRadius: '12px', padding: '14px', background: 'rgba(10,10,15,0.78)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div aria-live="polite" style={{ minHeight: '108px', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            {active === null ? (
              <p style={{ margin: 0, color: '#817B8E', fontSize: '13px', lineHeight: 1.6 }}>Hover a mark or choose a row. The list is the same field for keyboard and small-screen navigation.</p>
            ) : (
              <>
                <div style={{ fontFamily: MONO, fontSize: '9px', color: STATE_COLOUR[active.state], letterSpacing: '0.16em' }}>{active.kind.toUpperCase()} · {STATE_LABEL[active.state].toUpperCase()}</div>
                <div style={{ color: '#FFFFFF', fontSize: '14px', lineHeight: 1.45, marginTop: '7px', overflowWrap: 'anywhere' }}>{active.label}</div>
                <div style={{ color: '#777181', fontFamily: MONO, fontSize: '9.5px', lineHeight: 1.6, marginTop: '7px' }}>{active.date ?? 'DATE NOT RECORDED'}{active.sourceRef === null ? '' : ` · ${active.sourceRef}`}</div>
              </>
            )}
          </div>
          {selectedNode === null ? null : (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <Link to={`${prefix}/timeline`} style={actionLink}>OPEN TIMELINE</Link>
              <button onClick={openSource} disabled={selectedNode.sourceRef === null} style={actionButton}>OPEN SOURCE</button>
            </div>
          )}
          <ol aria-label="Memory field nodes" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '316px', overflow: 'auto' }}>
            {placed.map((node) => (
              <li key={`peer-${node.id}`}>
                <button aria-current={selected === node.id ? 'true' : undefined} onClick={() => setSelected(node.id)} onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') nextListButton(event, 1);
                  if (event.key === 'ArrowUp') nextListButton(event, -1);
                }} style={{ width: '100%', display: 'grid', gridTemplateColumns: '8px minmax(0,1fr) auto', gap: '9px', alignItems: 'center', textAlign: 'left', background: selected === node.id ? 'rgba(138,100,255,0.11)' : 'transparent', border: '1px solid transparent', borderRadius: '6px', color: '#B9B5C1', padding: '7px', cursor: 'pointer' }}>
                  <span aria-hidden="true" style={{ width: '7px', height: '7px', borderRadius: node.state === 'conflicted' ? 0 : '50%', border: `1px solid ${STATE_COLOUR[node.state]}`, background: node.state === 'current' ? STATE_COLOUR[node.state] : 'transparent' }} />
                  <span style={{ fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.label}</span>
                  <span style={{ fontFamily: MONO, fontSize: '8px', color: '#918B9F' }}>{node.kind.toUpperCase()}</span>
                </button>
              </li>
            ))}
          </ol>
          {graph.page.nextCursor === null ? null : (
            <button onClick={onLoadMore} disabled={loadingMore} style={{ ...actionButton, width: '100%' }}>{loadingMore ? 'LOADING NEXT PAGE' : 'LOAD NEXT GRAPH PAGE'}</button>
          )}
          {moreFailed ? <span role="status" style={{ color: '#FFB829', fontFamily: MONO, fontSize: '9px', lineHeight: 1.5 }}>THE NEXT PAGE DID NOT LOAD. TRY AGAIN.</span> : null}
        </aside>
      </div>
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontFamily: MONO, fontSize: '9px', letterSpacing: '0.12em', color: '#918B9F' }}>
        {OVERVIEW_STATES.filter((value): value is GraphNodeState => value !== 'all').map((value) => <span key={value} style={{ color: STATE_COLOUR[value] }}>{STATE_LABEL[value].toUpperCase()}</span>)}
      </div>
    </section>
  );
}

const cameraButton = {
  width: '30px', height: '30px', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '5px',
  background: 'rgba(8,8,12,0.84)', color: '#C9C5D2', cursor: 'pointer', fontFamily: MONO,
} as const;

const actionLink = {
  border: '1px solid rgba(255,255,255,0.13)', borderRadius: '6px', padding: '7px 9px', color: '#B9B5C1',
  fontFamily: MONO, fontSize: '9px', letterSpacing: '0.08em', textDecoration: 'none',
} as const;

const actionButton = {
  border: '1px solid rgba(255,255,255,0.13)', borderRadius: '6px', padding: '7px 9px', color: '#B9B5C1',
  background: 'transparent', fontFamily: MONO, fontSize: '9px', letterSpacing: '0.08em', cursor: 'pointer',
} as const;
