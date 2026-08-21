import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';

/**
 * A measured production run, not a made-up latency budget.
 *
 * The values are copied from
 * artifacts/verification/2026-08-21-v10/agent-conflict-run.json. `context`
 * covers the real HydraDB-backed Context Pack tool call. The two model stages
 * and total come from the same persisted run; orchestration is the measured
 * remainder, so the five rows reconcile exactly.
 */
const VERIFIED_RUN = {
  captured: '21 AUG 2026',
  artifact: 'artifacts/verification/2026-08-21-v10/agent-conflict-run.json',
  metrics: [
    { label: 'HYDRADB + CONTEXT', value: 300 },
    { label: 'RESEARCHER MODEL', value: 1_798 },
    { label: 'REVIEWER MODEL', value: 2_017 },
    { label: 'ORCHESTRATION', value: 1_237 },
    { label: 'END TO END', value: 5_352 },
  ],
} as const;

function eased(progress: number): number {
  const clamped = Math.max(0, Math.min(1, progress));
  return 1 - (1 - clamped) ** 3;
}

function useMeasuredProgress(section: RefObject<HTMLElement | null>): number {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const node = section.current;
    if (node === null) return undefined;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reduced || typeof IntersectionObserver === 'undefined') {
      setProgress(1);
      return undefined;
    }

    let frame = 0;
    let started = 0;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      const tick = (now: number) => {
        if (started === 0) started = now;
        const next = Math.min(1, (now - started) / 1_250);
        setProgress(next);
        if (next < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }, { threshold: 0.24 });
    observer.observe(node);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [section]);

  return progress;
}

export function Speed() {
  const section = useRef<HTMLElement | null>(null);
  const progress = useMeasuredProgress(section);

  return (
    <section ref={section} data-scene="speed" className="speed-scene" style={{ position: 'relative', height: '190vh' }}>
      <div className="speed-stage" style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>
        <div className="speed-heading" style={{ position: 'absolute', top: 'max(12%, 96px)', left: 0, right: 0, textAlign: 'center', padding: '0 20px' }}>
          <h2 style={{ fontSize: 'clamp(38px, 4.2vw, 72px)', fontWeight: 400, lineHeight: 1.02, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>Keep the context path short.</h2>
          <p style={{ fontSize: '17px', lineHeight: 1.7, color: '#A7A7AD', margin: '16px auto 0', maxWidth: '46ch' }}>Less context to move. Less context for the model to read. The evidence stays attached.</p>
        </div>

        <div
          className="speed-metrics"
          data-shield
          data-source-artifact={VERIFIED_RUN.artifact}
          aria-label={`Measured production agent run from ${VERIFIED_RUN.captured}`}
        >
          <div className="speed-metrics-head">
            <span>VERIFIED PRODUCTION RUN</span>
            <time dateTime="2026-08-21">{VERIFIED_RUN.captured}</time>
          </div>
          {VERIFIED_RUN.metrics.map((metric, index) => {
            const rowProgress = eased((progress - index * 0.09) / 0.64);
            const visibleValue = Math.round(metric.value * rowProgress);
            return (
              <div className="speed-metric" key={metric.label} style={{ '--metric-progress': rowProgress } as CSSProperties}>
                <span className="speed-metric-label">{metric.label}</span>
                <span className="speed-metric-track" aria-hidden="true"><span /></span>
                <span className="speed-metric-value" data-speed-value={metric.value} aria-label={`${metric.value.toLocaleString('en-US')} milliseconds`}>
                  {visibleValue.toLocaleString('en-US')} <small>MS</small>
                </span>
              </div>
            );
          })}
          <span className="speed-metrics-note">ONE PERSISTED CONFLICT-REVIEW RUN · VALUES RECONCILE TO END TO END</span>
        </div>
      </div>
    </section>
  );
}
