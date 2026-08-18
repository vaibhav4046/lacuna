import type { ReactNode } from 'react';
import type { Loaded } from '../api/client';
import { MONO } from '../design/mark';

/**
 * The four things a list on this screen can be, and how each one reads.
 *
 * The design draws exactly one empty state, on the dashboard's recent runs
 * panel: a fifteen pixel white sentence over a thirteen and a half pixel grey
 * one. Every other list in the design is drawn full, because a mockup has no
 * empty case. This reuses that one treatment rather than inventing a second, so
 * an empty panel anywhere in the product looks like the panel the design drew
 * empty on purpose.
 *
 * A failure is not an empty state. "Nothing here" and "we could not find out"
 * are different sentences and the difference is the entire product, so a failed
 * load says so in the design's plain error voice rather than showing zero rows.
 *
 * Loading says which stage it is in. Never a percentage, never a bar.
 */

export function Empty({ headline, detail }: { headline: string; detail: string }) {
  return (
    <div style={{ padding: '22px 2px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <span style={{ fontSize: '15px', color: '#FFFFFF' }}>{headline}</span>
      <span style={{ fontSize: '13.5px', color: '#9A9A9A' }}>{detail}</span>
    </div>
  );
}

export function Stage({ label }: { label: string }) {
  return (
    <div style={{ padding: '22px 2px' }}>
      <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#5E5E5E' }}>{label}</span>
    </div>
  );
}

export function Failed({ reason }: { reason: string }) {
  return (
    <div style={{ padding: '22px 2px' }}>
      <span role="alert" style={{ fontSize: '14px', color: '#BDBDBD' }}>{reason}</span>
    </div>
  );
}

/**
 * Renders one panel's worth of a loaded list. `stage` is the named step this
 * panel is waiting on, `empty` the two sentences it shows when the answer is
 * genuinely nothing.
 */
export function Panel<T>({ loaded, stage, empty, children }: {
  loaded: Loaded<readonly T[]>;
  stage: string;
  empty: { readonly headline: string; readonly detail: string };
  children: (rows: readonly T[]) => ReactNode;
}) {
  if (loaded.state === 'loading') return <Stage label={stage} />;
  if (loaded.state === 'failed') return <Failed reason={loaded.reason} />;
  if (loaded.value.length === 0) return <Empty headline={empty.headline} detail={empty.detail} />;
  return <>{children(loaded.value)}</>;
}
