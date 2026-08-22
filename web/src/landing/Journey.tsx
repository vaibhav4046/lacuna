import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';

import { Mark } from '../design/mark';

interface JourneyStage {
  readonly id: string;
  readonly scene: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
  readonly artifactLabel: string;
  readonly artifactValue: string;
  readonly rows: readonly (readonly [string, string, 'violet' | 'amber' | 'muted'])[];
  readonly action: string;
  readonly path: string;
}

const STAGES: readonly JourneyStage[] = [
  {
    id: 'current',
    scene: 'temporal',
    eyebrow: '01 · CURRENT',
    title: 'Find what is true now.',
    body: 'Lacuna finds the fact that is still current and keeps its quote, source, and time attached.',
    artifactLabel: 'FOXGLOVE · BETA PARTNER',
    artifactValue: 'Stonecrop',
    rows: [
      ['STANDING', 'CURRENT', 'violet'],
      ['REPLACES', 'Millbrace', 'muted'],
      ['EVIDENCE', 'Data handover notes', 'muted'],
    ],
    action: 'Open the answer',
    path: '/explore/ask',
  },
  {
    id: 'history',
    scene: 'temporal',
    eyebrow: '02 · HISTORY',
    title: 'Keep the old fact without letting it win.',
    body: 'A correction updates the answer without deleting the old value. You can still see both in history.',
    artifactLabel: 'FOXGLOVE · TIMELINE',
    artifactValue: 'Millbrace  →  Stonecrop',
    rows: [
      ['2025-01-06', 'HISTORICAL', 'muted'],
      ['2025-01-10', 'CURRENT', 'violet'],
      ['CHAIN', '1 SUPERSESSION', 'muted'],
    ],
    action: 'Inspect the timeline',
    path: '/explore/timeline',
  },
  {
    id: 'conflict',
    scene: 'contra',
    eyebrow: '03 · CONFLICT',
    title: 'Refuse to invent consensus.',
    body: 'The billing-gate record names two runbook owners and neither source resolves the other. Lacuna preserves both claims and returns no answer.',
    artifactLabel: 'BILLING-GATE · RUNBOOK OWNER',
    artifactValue: 'Rasmus Berg  ≠  Priya Raman',
    rows: [
      ['CURRENT CLAIMS', '2', 'amber'],
      ['RESOLUTION', 'NONE', 'amber'],
      ['RESULT', 'CONTRADICTED', 'amber'],
    ],
    action: 'Inspect the conflict',
    path: '/explore/graph',
  },
  {
    id: 'hydra',
    scene: 'hydra',
    eyebrow: '04 · GRAPH + TABLE',
    title: 'Move through the field. Verify in rows.',
    body: 'HydraDB holds the temporal evidence graph. The overview is for navigation; the proof path shows exact edges; the table makes every visible record readable.',
    artifactLabel: 'EXACT PROOF PATH',
    artifactValue: 'Question  →  Claim  →  Evidence  →  Source',
    rows: [
      ['OVERVIEW', 'NAVIGABLE FIELD', 'violet'],
      ['PROOF', 'DETERMINISTIC EDGES', 'violet'],
      ['FALLBACK', 'READABLE TABLE', 'muted'],
    ],
    action: 'Explore the graph',
    path: '/explore/graph',
  },
  {
    id: 'mcp',
    scene: 'mcp',
    eyebrow: '05 · CLIENTS',
    title: 'Connect the tools you already use.',
    body: 'Claude, ChatGPT read and fetch, Codex, local runtimes and custom clients can address the same workspace through MCP, the CLI or the HTTP API.',
    artifactLabel: 'ONE WORKSPACE ADDRESS',
    artifactValue: 'MCP  ·  CLI  ·  API',
    rows: [
      ['MCP', 'STDIO + REMOTE', 'violet'],
      ['CLI', 'DOCTOR · READ · EXPLAIN', 'muted'],
      ['CONTEXT', 'NO CLIENT-SIDE COPY', 'muted'],
    ],
    action: 'Connect MCP',
    path: '/explore/mcp',
  },
  {
    id: 'agents',
    scene: 'any',
    eyebrow: '06 · AGENTS',
    title: 'Turn memory into governed work.',
    body: 'Researcher and Reviewer start with only the facts they need. Each run keeps its steps, tools, files, result, and schedule.',
    artifactLabel: 'GOVERNED RUN',
    artifactValue: 'Researcher  →  Reviewer',
    rows: [
      ['INPUT', 'CONTEXT PACK', 'violet'],
      ['OUTPUT', 'REPLAYABLE ARTIFACT', 'violet'],
      ['WRITEBACK', 'POLICY CONTROLLED', 'muted'],
    ],
    action: 'Open agent runtime',
    path: '/explore/agents',
  },
  {
    id: 'voice',
    scene: 'any',
    eyebrow: '07 · VOICE',
    title: 'Talk to the same evidence path.',
    body: 'The governed voice route exposes listening, transcription, thinking, speaking, interruption and failure as explicit states. When speech is unavailable, the typed path remains.',
    artifactLabel: 'VOICE STATE MACHINE',
    artifactValue: 'Listen  →  Think  →  Speak',
    rows: [
      ['TRANSCRIPT', 'SCRIBE REALTIME', 'violet'],
      ['OUTPUT', 'STREAMED SPEECH', 'violet'],
      ['FALLBACK', 'TYPED QUESTION', 'muted'],
    ],
    action: 'Open voice',
    path: '/explore/voice',
  },
  {
    id: 'docs',
    scene: 'quiet',
    eyebrow: '08 · BUILD',
    title: 'Inspect the contract, then integrate.',
    body: 'The product exposes its SDK and API contract, MCP transports, CLI commands, health checks, HydraDB boundary and measured evaluation artifacts inside the workspace.',
    artifactLabel: 'LOCAL MCP',
    artifactValue: 'npm run mcp -- --stdio',
    rows: [
      ['CLI', 'node bin/lacuna.js doctor', 'muted'],
      ['SDK', 'STRUCTURED RESULTS', 'violet'],
      ['PROOF', 'REPOSITORY ARTIFACTS', 'muted'],
    ],
    action: 'Read SDK + API',
    path: '/explore/sdk',
  },
];

export function Journey() {
  const go = useNavigate();
  const [active, setActive] = useState(0);
  const steps = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible === undefined) return;
      const index = Number((visible.target as HTMLElement).dataset['journeyIndex']);
      if (Number.isFinite(index)) setActive(index);
    }, { threshold: [0.35, 0.55, 0.75], rootMargin: '-20% 0px -20% 0px' });
    steps.current.forEach((step) => { if (step !== null) observer.observe(step); });
    return () => observer.disconnect();
  }, []);

  const stage = STAGES[active] ?? STAGES[0];
  if (stage === undefined) return null;

  return (
    <section id="journey" className="memory-journey" aria-labelledby="journey-heading">
      <div className="journey-intro" data-reveal>
        <span className="landing-kicker">THE MEMORY JOURNEY</span>
        <h2 id="journey-heading">One open loop.<br />Every piece of context.</h2>
        <p>The spiral never closes because missing evidence stays missing. Follow one memory as Lacuna resolves it, preserves its history, routes it into work and exposes the proof.</p>
      </div>

      <div className="journey-grid">
        <div className="journey-sticky" aria-live="polite">
          <div className="journey-lens" data-kind={stage.id} style={{ '--journey-turn': `${active * 34}deg` } as CSSProperties}>
            <div className="journey-spiral" aria-hidden="true">
              <span className="journey-spiral-ring" />
              <span className="journey-mark-motion"><Mark size={176} className="journey-mark" /></span>
              <span className="journey-aperture">{String(active + 1).padStart(2, '0')}</span>
            </div>
            <div className="journey-artifact">
              <div className="journey-artifact-head">
                <span>{stage.artifactLabel}</span>
                <span>{String(active + 1).padStart(2, '0')} / {String(STAGES.length).padStart(2, '0')}</span>
              </div>
              <div className="journey-artifact-value">{stage.artifactValue}</div>
              <div className="journey-artifact-rows">
                {stage.rows.map(([label, value, tone]) => (
                  <div key={`${label}-${value}`}>
                    <span>{label}</span>
                    <strong data-tone={tone}>{value}</strong>
                  </div>
                ))}
              </div>
            </div>
            <div className="journey-progress" aria-hidden="true">
              {STAGES.map((item, index) => <span key={item.id} data-active={index <= active ? 'true' : 'false'} />)}
            </div>
          </div>
        </div>

        <div className="journey-steps">
          {STAGES.map((item, index) => (
            <article
              id={item.id}
              key={item.id}
              ref={(node) => { steps.current[index] = node; }}
              data-journey-index={index}
              data-scene={item.scene}
              data-active={active === index ? 'true' : 'false'}
              className="journey-step"
            >
              <div className="journey-step-copy" data-shield>
                <span className="landing-kicker">{item.eyebrow}</span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
                <button type="button" onClick={() => go(item.path)}>{item.action}<span aria-hidden="true">↗</span></button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
