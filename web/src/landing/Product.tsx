import { useNavigate } from 'react-router-dom';

import { MONO } from '../design/mark';

interface Surface {
  readonly label: string;
  readonly title: string;
  readonly body: string;
  readonly meta: string;
  readonly path: string;
}

const SURFACES: readonly Surface[] = [
  {
    label: '01 · ANSWER',
    title: 'Plain English, with the record attached.',
    body: 'Ask a normal question. Lacuna returns the current answer, explains what changed, cites the source, and exposes the artifact behind it.',
    meta: 'ANSWER · EVIDENCE · EXPLANATION',
    path: '/explore/ask',
  },
  {
    label: '02 · MEMORY',
    title: 'The whole memory is still readable.',
    body: 'Search and filter the claim table by subject, scope, standing, source, and observation time. History is retained instead of flattened.',
    meta: '72 SESSIONS · 5,268 MESSAGES · 118 CLAIMS',
    path: '/explore/memory',
  },
  {
    label: '03 · GRAPH',
    title: 'Explore the data, then inspect the rows.',
    body: 'Move through the workspace overview or trace one answer from query to claim, evidence, and source. Every visible edge has a readable table row.',
    meta: 'OVERVIEW · PROOF PATH · TABLE',
    path: '/explore/graph',
  },
  {
    label: '04 · AGENTS',
    title: 'Research, review, schedule, and replay.',
    body: 'A Researcher works from a governed Context Pack. A Reviewer checks the same evidence. Runs keep their steps, artifacts, timing, and final state.',
    meta: 'RUNTIME · WORK · TOOLS · SCHEDULES',
    path: '/explore/agents',
  },
  {
    label: '05 · VOICE',
    title: 'Talk to the same memory.',
    body: 'ElevenLabs realtime speech becomes the same evidence-bearing question. Listening, thinking, speaking, interruption, error, and text fallback stay explicit.',
    meta: 'SCRIBE V2 REALTIME · STREAMED SPEECH',
    path: '/explore/voice',
  },
  {
    label: '06 · EVERYWHERE',
    title: 'One remote memory address.',
    body: 'Use the HTTP API, CLI, stdio MCP, or workspace-scoped remote MCP from Claude, ChatGPT read and fetch, Codex, local agents, and custom clients.',
    meta: 'MCP · CLI · API · CLIENT-NEUTRAL',
    path: '/explore/mcp',
  },
];

export function Product() {
  const go = useNavigate();

  return (
    <section id="product" data-scene="quiet" style={{ position: 'relative', padding: '12vh clamp(20px, 4.4vw, 72px) 16vh' }}>
      <div data-reveal style={{ maxWidth: '1180px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '38px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '36px', alignItems: 'end', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '720px' }}>
            <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.22em', color: '#8052FF' }}>THE FULL PRODUCT</span>
            <h2 style={{ fontSize: 'clamp(38px, 4.5vw, 76px)', fontWeight: 400, lineHeight: 1.01, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>
              A memory layer you can inspect, not a chat box you have to trust.
            </h2>
          </div>
          <button className="hv-text" onClick={() => go('/judge')} style={{ background: 'none', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.25)', cursor: 'pointer', color: '#BDBDBD', padding: '7px 0', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.18em' }}>
            OPEN THE JUDGE PROOF
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', borderTop: '1px solid rgba(255,255,255,0.12)', borderLeft: '1px solid rgba(255,255,255,0.12)' }}>
          {SURFACES.map((surface) => (
            <button
              key={surface.label}
              type="button"
              className="hv-surface4"
              onClick={() => go(surface.path)}
              style={{ minHeight: '270px', display: 'flex', flexDirection: 'column', gap: '18px', textAlign: 'left', padding: '28px', color: 'inherit', background: 'rgba(0,0,0,0.32)', border: 'none', borderRight: '1px solid rgba(255,255,255,0.12)', borderBottom: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer', transition: 'background 220ms ease, transform 320ms cubic-bezier(0.22, 1, 0.36, 1)' }}
            >
              <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.18em', color: '#8052FF' }}>{surface.label}</span>
              <span style={{ fontSize: '25px', lineHeight: 1.15, letterSpacing: '-0.02em', color: '#FFFFFF', maxWidth: '25ch' }}>{surface.title}</span>
              <span style={{ fontSize: '14.5px', lineHeight: 1.65, color: '#9A9A9A', maxWidth: '42ch' }}>{surface.body}</span>
              <span style={{ marginTop: 'auto', fontFamily: MONO, fontSize: '9.5px', lineHeight: 1.7, letterSpacing: '0.13em', color: '#6F6F76' }}>{surface.meta}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
