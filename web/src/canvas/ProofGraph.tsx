import { useMemo, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';

import { MONO } from '../design/mark';
import { proofLayout } from '../graph/layout';
import {
  STATE_COLOUR,
  STATE_LABEL,
  type GraphEdge,
  type GraphEnvelope,
  type GraphNode,
  type GraphNodeState,
  type PlacedGraphNode,
  type GraphRelation,
} from '../graph/types';

const RELATIONS: readonly ('all' | GraphRelation)[] = [
  'all', 'supports', 'supersedes', 'contradicts', 'mentions', 'depends_on', 'impact', 'contains', 'about', 'connects',
];

const LAYER_LABEL = ['SOURCE', 'EVIDENCE', 'CLAIM', 'ENTITY', 'CONTEXT PACK', 'CLIENT / AGENT'] as const;

function edgeColour(edge: GraphEdge): string {
  if (edge.rejected) return '#FFB829';
  if (edge.relation === 'supports') return '#8A64FF';
  if (edge.relation === 'contradicts') return '#D9A441';
  if (edge.relation === 'supersedes') return '#888295';
  if (edge.relation === 'impact') return '#5D9F90';
  return '#666170';
}

function edgePath(from: PlacedGraphNode, to: PlacedGraphNode, sequence: number): string {
  const x1 = from.x + 172;
  const y1 = from.y + 28;
  const x2 = to.x;
  const y2 = to.y + 28;
  if (from.layer === to.layer) {
    const lift = 34 + (sequence % 5) * 12;
    return `M ${x1} ${y1} C ${x1 + lift} ${y1 - lift}, ${x2 + 172 + lift} ${y2 - lift}, ${x2 + 172} ${y2}`;
  }
  const bend = Math.max(26, (x2 - x1) * 0.48);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

function listArrow(event: KeyboardEvent<HTMLButtonElement>, direction: 1 | -1): void {
  const item = event.currentTarget.closest('li');
  const sibling = direction === 1 ? item?.nextElementSibling : item?.previousElementSibling;
  const button = sibling?.querySelector('button');
  if (button instanceof HTMLButtonElement) {
    event.preventDefault();
    button.focus();
  }
}

interface ProofGraphProps {
  readonly graph: GraphEnvelope;
  readonly prefix: string;
  readonly loadingMore: boolean;
  readonly moreFailed: boolean;
  readonly onLoadMore: () => void;
}

/** A fixed-layer provenance DAG. It never borrows the overview spiral. */
export function ProofGraph({ graph, prefix, loadingMore, moreFailed, onLoadMore }: ProofGraphProps) {
  const [query, setQuery] = useState('');
  const [relation, setRelation] = useState<'all' | GraphRelation>('all');
  const [state, setState] = useState<'all' | GraphNodeState>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const nodeMatches = (node: GraphNode) => state === 'all' || node.state === state;
    const textMatches = (node: GraphNode) => needle === ''
      || `${node.label} ${node.detail ?? ''} ${node.sourceRef ?? ''}`.toLocaleLowerCase().includes(needle);
    const direct = new Set(graph.nodes.filter((node) => nodeMatches(node) && textMatches(node)).map((node) => node.id));
    const edges = graph.edges.filter((edge) => (relation === 'all' || edge.relation === relation)
      && (needle === '' || direct.has(edge.from) || direct.has(edge.to)
        || `${edge.label ?? ''} ${edge.sourceRef ?? ''}`.toLocaleLowerCase().includes(needle)));
    const connected = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
    const nodes = graph.nodes.filter((node) => nodeMatches(node) && (needle === '' || direct.has(node.id) || connected.has(node.id)));
    return { nodes, edges };
  }, [graph.edges, graph.nodes, query, relation, state]);
  const layout = useMemo(() => proofLayout(filtered.nodes, filtered.edges), [filtered]);
  const positions = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout.nodes]);
  const selectedNode = graph.nodes.find((node) => node.id === selected) ?? null;
  const activeEdge = graph.edges.find((edge) => edge.id === hoveredEdge) ?? null;
  const viewWidth = layout.width / camera.zoom;
  const viewHeight = layout.height / camera.zoom;
  const viewX = (layout.width - viewWidth) / 2 + camera.x;
  const viewY = (layout.height - viewHeight) / 2 + camera.y;
  const openSource = () => {
    if (selectedNode === null || selectedNode.sourceRef === null) return;
    const source = graph.nodes.find((node) => node.kind === 'source' && node.label === selectedNode.sourceRef);
    if (source !== undefined) setSelected(source.id);
  };
  const focusPack = () => {
    const pack = graph.nodes.find((node) => node.kind === 'context_pack');
    if (pack !== undefined) setSelected(pack.id);
  };

  return (
    <section aria-labelledby="proof-graph-heading" style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '18px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ maxWidth: '67ch' }}>
          <div id="proof-graph-heading" style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#D1C8EA' }}>PROOF GRAPH · EXACT PROVENANCE</div>
          <p style={{ margin: '8px 0 0', color: '#9A9A9A', fontSize: '14px', lineHeight: 1.65 }}>
            Read left to right from source and quoted evidence to claim and entity. Supersession, contradiction, dependency and impact edges remain explicit. Dashed amber edges were reached and rejected; they were not used as proof.
          </p>
        </div>
        <div style={{ fontFamily: MONO, fontSize: '9px', letterSpacing: '0.13em', color: '#918B9F', textAlign: 'right' }}>
          DETERMINISTIC LAYERS · NO PHYSICS<br />{layout.nodes.length} NODES · {layout.edges.length} EDGES VISIBLE
        </div>
      </div>

      <div style={{ display: 'flex', gap: '9px', alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ flex: '1 1 250px' }}>
          <span style={visuallyHidden}>Search the proof graph</span>
          <input className="fv-violet" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search proof, source or date" style={inputStyle} />
        </label>
        <label style={filterLabel}>STATE
          <select value={state} onChange={(event) => setState(event.target.value as 'all' | GraphNodeState)} style={selectStyle}>
            <option value="all">All states</option>
            {(Object.keys(STATE_LABEL) as GraphNodeState[]).map((value) => <option key={value} value={value}>{STATE_LABEL[value]}</option>)}
          </select>
        </label>
        <label style={filterLabel}>EDGE
          <select value={relation} onChange={(event) => setRelation(event.target.value as 'all' | GraphRelation)} style={selectStyle}>
            {RELATIONS.map((value) => <option key={value} value={value}>{value === 'all' ? 'All relations' : value.replace(/_/gu, ' ')}</option>)}
          </select>
        </label>
        <button onClick={focusPack} disabled={!graph.nodes.some((node) => node.kind === 'context_pack')} style={smallButton}>FOCUS PACK</button>
      </div>

      {layout.nodes.length === 0 ? (
        <div style={{ minHeight: '220px', display: 'grid', placeItems: 'center', border: '1px solid rgba(255,255,255,0.10)', borderRadius: '10px', color: '#817B8E', fontSize: '14px', padding: '28px', textAlign: 'center' }}>No proof nodes match these filters. Clear the search or choose another state or edge.</div>
      ) : (
        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'stretch' }}>
          <div style={{ flex: '2 1 650px', minWidth: 0, position: 'relative', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.11)', borderRadius: '10px', background: 'linear-gradient(90deg, rgba(138,100,255,0.025), rgba(7,7,11,0.92) 28%, rgba(7,7,11,0.92))' }}>
            <div role="group" aria-label="Pan and zoom proof graph" style={{ position: 'absolute', zIndex: 2, top: '9px', right: '9px', display: 'flex', gap: '4px' }}>
              <button aria-label="Pan proof graph left" onClick={() => setCamera((it) => ({ ...it, x: it.x - 80 / it.zoom }))} style={cameraButton}>←</button>
              <button aria-label="Pan proof graph right" onClick={() => setCamera((it) => ({ ...it, x: it.x + 80 / it.zoom }))} style={cameraButton}>→</button>
              <button aria-label="Zoom proof graph out" onClick={() => setCamera((it) => ({ ...it, zoom: Math.max(0.65, Number((it.zoom - 0.15).toFixed(2))) }))} style={cameraButton}>−</button>
              <button aria-label="Reset proof graph view" onClick={() => setCamera({ x: 0, y: 0, zoom: 1 })} style={cameraButton}>•</button>
              <button aria-label="Zoom proof graph in" onClick={() => setCamera((it) => ({ ...it, zoom: Math.min(2.2, Number((it.zoom + 0.15).toFixed(2))) }))} style={cameraButton}>+</button>
            </div>
            <svg viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`} role="group" aria-label="Layered evidence provenance graph" style={{ width: '100%', minHeight: '460px', display: 'block' }}>
              <defs>
                <marker id="proof-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7Z" fill="#777181" /></marker>
                <marker id="proof-rejected" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7Z" fill="#FFB829" /></marker>
              </defs>
              {LAYER_LABEL.map((label, layer) => <text key={label} x={38 + layer * 216} y="27" fill="#918B9F" fontFamily="JetBrains Mono, monospace" fontSize="9" letterSpacing="1.8">{label}</text>)}
              {layout.edges.map((edge, index) => {
                const from = positions.get(edge.from);
                const to = positions.get(edge.to);
                if (from === undefined || to === undefined) return null;
                const path = edgePath(from, to, index);
                const colour = edgeColour(edge);
                return (
                  <g key={edge.id} onMouseEnter={() => setHoveredEdge(edge.id)} onMouseLeave={() => setHoveredEdge(null)} tabIndex={0} role="button" aria-label={`${edge.relation.replace(/_/gu, ' ')} from ${from.label} to ${to.label}${edge.rejected ? `, rejected: ${edge.rejectionReason}` : ''}`} onFocus={() => setHoveredEdge(edge.id)} onBlur={() => setHoveredEdge(null)}>
                    <path d={path} fill="none" stroke="transparent" strokeWidth="12" />
                    <path d={path} fill="none" stroke={colour} strokeWidth={hoveredEdge === edge.id ? 2.1 : 1.15} strokeDasharray={edge.rejected ? '5 5' : edge.relation === 'supersedes' ? '3 4' : undefined} markerEnd={`url(#${edge.rejected ? 'proof-rejected' : 'proof-arrow'})`} />
                    {edge.label === null ? null : <text x={(from.x + to.x + 172) / 2} y={(from.y + to.y) / 2 + 19} textAnchor="middle" fill={colour} fontFamily="JetBrains Mono, monospace" fontSize="7.5">{edge.label.slice(0, 30)}</text>}
                  </g>
                );
              })}
              {layout.nodes.map((node) => {
                const isSelected = selected === node.id;
                return (
                  <g key={node.id} transform={`translate(${node.x} ${node.y})`} role="button" tabIndex={0} aria-label={`${node.kind}: ${node.label}. ${STATE_LABEL[node.state]}`} aria-pressed={isSelected} onClick={() => setSelected(node.id)} onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelected(node.id);
                    }
                  }} style={{ cursor: 'pointer' }}>
                    <rect width="172" height="56" rx="5" fill={isSelected ? 'rgba(138,100,255,0.13)' : 'rgba(12,12,18,0.96)'} stroke={isSelected ? '#D9D1EE' : STATE_COLOUR[node.state]} strokeWidth={isSelected ? 1.8 : 1} strokeDasharray={node.state === 'missing' ? '4 3' : undefined} />
                    <circle cx="12" cy="13" r="3" fill={node.state === 'historical' || node.state === 'missing' ? '#0C0C12' : STATE_COLOUR[node.state]} stroke={STATE_COLOUR[node.state]} />
                    <text x="21" y="16" fill="#777181" fontFamily="JetBrains Mono, monospace" fontSize="7.5" letterSpacing="1.1">{node.kind.toUpperCase()}</text>
                    <text x="11" y="34" fill={node.state === 'historical' ? '#898491' : '#E2DFE7'} fontFamily="Space Grotesk, sans-serif" fontSize="10.5">{node.label.slice(0, 27)}</text>
                    <text x="11" y="48" fill="#918B9F" fontFamily="JetBrains Mono, monospace" fontSize="7.5">{node.date === null ? STATE_LABEL[node.state].toUpperCase() : node.date.slice(0, 10)}</text>
                  </g>
                );
              })}
            </svg>
          </div>

          <aside style={{ flex: '1 1 285px', minWidth: 0, border: '1px solid rgba(255,255,255,0.10)', borderRadius: '10px', padding: '13px', background: 'rgba(9,9,14,0.84)', display: 'flex', flexDirection: 'column', gap: '11px' }}>
            <div aria-live="polite" style={{ minHeight: '112px', paddingBottom: '10px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              {activeEdge !== null ? (
                <>
                  <div style={{ fontFamily: MONO, fontSize: '9px', color: edgeColour(activeEdge), letterSpacing: '0.14em' }}>{activeEdge.relation.replace(/_/gu, ' ').toUpperCase()}{activeEdge.rejected ? ' · REJECTED' : ' · USED'}</div>
                  <div style={{ color: '#C7C3CE', fontSize: '12.5px', lineHeight: 1.55, marginTop: '7px', overflowWrap: 'anywhere' }}>{activeEdge.label ?? activeEdge.relation.replace(/_/gu, ' ')}</div>
                  <div style={{ color: '#918B9F', fontFamily: MONO, fontSize: '9px', lineHeight: 1.6, marginTop: '7px' }}>{activeEdge.rejectionReason?.replace(/_/gu, ' ').toUpperCase() ?? 'ACCEPTED PATH'} · {activeEdge.date ?? 'DATE NOT RECORDED'}</div>
                </>
              ) : selectedNode !== null ? (
                <>
                  <div style={{ fontFamily: MONO, fontSize: '9px', color: STATE_COLOUR[selectedNode.state], letterSpacing: '0.14em' }}>{selectedNode.kind.toUpperCase()} · {STATE_LABEL[selectedNode.state].toUpperCase()}</div>
                  <div style={{ color: '#FFFFFF', fontSize: '13.5px', lineHeight: 1.5, marginTop: '7px', overflowWrap: 'anywhere' }}>{selectedNode.label}</div>
                  <div style={{ color: '#918B9F', fontFamily: MONO, fontSize: '9px', lineHeight: 1.6, marginTop: '7px' }}>{selectedNode.date ?? 'DATE NOT RECORDED'}{selectedNode.sourceRef === null ? '' : ` · ${selectedNode.sourceRef}`}</div>
                </>
              ) : (
                <p style={{ margin: 0, color: '#817B8E', fontSize: '13px', lineHeight: 1.6 }}>Choose a node or focus an edge. Source and date stay beside the selected proof.</p>
              )}
            </div>
            {selectedNode === null ? null : <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap' }}>
              <Link to={`${prefix}/timeline`} style={actionLink}>OPEN TIMELINE</Link>
              <button onClick={openSource} disabled={selectedNode.sourceRef === null} style={smallButton}>OPEN SOURCE</button>
            </div>}
            <ol aria-label="Proof graph edges" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '5px', maxHeight: '330px', overflow: 'auto' }}>
              {layout.edges.map((edge) => {
                const from = positions.get(edge.from);
                const to = positions.get(edge.to);
                if (from === undefined || to === undefined) return null;
                return <li key={`peer-${edge.id}`}>
                  <button onClick={() => setSelected(edge.to)} onFocus={() => setHoveredEdge(edge.id)} onBlur={() => setHoveredEdge(null)} onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') listArrow(event, 1);
                    if (event.key === 'ArrowUp') listArrow(event, -1);
                  }} style={{ width: '100%', textAlign: 'left', background: edge.rejected ? 'rgba(255,184,41,0.045)' : 'transparent', color: '#AAA6B2', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', padding: '8px', cursor: 'pointer' }}>
                    <span style={{ display: 'block', fontSize: '11px', lineHeight: 1.4, overflowWrap: 'anywhere' }}><span style={{ color: '#E0DDE5' }}>{from.label}</span> <span style={{ color: edgeColour(edge) }}>{edge.relation.replace(/_/gu, ' ')}</span> <span style={{ color: '#E0DDE5' }}>{to.label}</span></span>
                    <span style={{ display: 'block', marginTop: '4px', fontFamily: MONO, fontSize: '8px', letterSpacing: '0.1em', color: edgeColour(edge) }}>{edge.rejected ? `REJECTED · ${edge.rejectionReason?.replace(/_/gu, ' ')}` : 'USED'} · {edge.date ?? 'DATE NOT RECORDED'}</span>
                  </button>
                </li>;
              })}
            </ol>
            {graph.page.nextCursor === null ? null : <button onClick={onLoadMore} disabled={loadingMore} style={{ ...smallButton, width: '100%' }}>{loadingMore ? 'LOADING NEXT PAGE' : 'LOAD NEXT GRAPH PAGE'}</button>}
            {moreFailed ? <span role="status" style={{ color: '#FFB829', fontFamily: MONO, fontSize: '9px', lineHeight: 1.5 }}>THE NEXT PAGE DID NOT LOAD. TRY AGAIN.</span> : null}
          </aside>
        </div>
      )}

      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontFamily: MONO, fontSize: '9px', letterSpacing: '0.1em', color: '#777181' }}>
        <span style={{ color: '#8A64FF' }}>EVIDENCE → CLAIM</span><span>SUPERSEDES</span><span style={{ color: '#D9A441' }}>CONTRADICTS</span><span>MENTIONS</span><span>DEPENDS ON</span><span style={{ color: '#5D9F90' }}>IMPACT PATH</span><span style={{ color: '#FFB829' }}>- - REJECTED</span>
      </div>
    </section>
  );
}

const visuallyHidden = { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)' } as const;
const inputStyle = { width: '100%', boxSizing: 'border-box', background: 'rgba(8,8,12,0.72)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '7px', padding: '10px 12px', color: '#FFFFFF', fontFamily: MONO, fontSize: '11px', outline: 'none' } as const;
const filterLabel = { display: 'flex', alignItems: 'center', gap: '7px', fontFamily: MONO, fontSize: '9px', color: '#817B8E' } as const;
const selectStyle = { background: '#101017', color: '#D8D4E2', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '7px', padding: '9px', fontFamily: MONO, fontSize: '9px' } as const;
const smallButton = { border: '1px solid rgba(255,255,255,0.13)', borderRadius: '6px', padding: '8px 9px', color: '#B9B5C1', background: 'transparent', fontFamily: MONO, fontSize: '9px', letterSpacing: '0.08em', cursor: 'pointer' } as const;
const cameraButton = { width: '29px', height: '29px', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '5px', background: 'rgba(8,8,12,0.86)', color: '#C9C5D2', cursor: 'pointer', fontFamily: MONO } as const;
const actionLink = { border: '1px solid rgba(255,255,255,0.13)', borderRadius: '6px', padding: '8px 9px', color: '#B9B5C1', fontFamily: MONO, fontSize: '9px', letterSpacing: '0.08em', textDecoration: 'none' } as const;
