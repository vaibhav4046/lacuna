/**
 * The live checks behind every state word the app prints.
 *
 * The design writes HYDRADB CONNECTED and MODEL · QWEN2.5 · LOCAL as fixed
 * text. Those are assertions about a running system, and the design's own rule
 * is that an unchecked state is never displayed, so the words stay and the
 * source of truth changes: they come from the same doctor the CLI runs, over
 * /api/health, and fall back to an em dash while nothing has been checked.
 *
 * Every state word the app can print is in this file on purpose. There is one
 * place to audit when the question is "was that checked".
 */

import { useLoaded } from './client';
import type { Loaded } from './client';

export type CheckState = 'pass' | 'warn' | 'fail';

export interface HealthCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly state: CheckState;
  readonly detail: string;
}

/** The shape of doctorPayload, which is what /api/health returns. */
export interface HealthReport {
  readonly command: 'doctor';
  readonly ok: boolean;
  readonly warnings: number;
  readonly exitCode: number;
  readonly checks: readonly HealthCheck[];
}

/** Nothing has been checked yet. Not a state, the absence of one. */
export const UNCHECKED = '—';

export function useHealth(): Loaded<HealthReport> {
  return useLoaded<HealthReport>('/api/health');
}

function stateOf(report: HealthReport, name: string): CheckState | null {
  const check = report.checks.find((c) => c.name === name);
  return check === undefined ? null : check.state;
}

/**
 * A configuration or token problem is NOT CONFIGURED; a node that will not
 * answer is FAILED. They read the same to a user staring at a blank screen and
 * they are completely different to whoever has to fix it.
 */
export function hydraState(loaded: Loaded<HealthReport>): string {
  if (loaded.state !== 'ready') return UNCHECKED;
  const report = loaded.value;
  if (stateOf(report, 'config') === 'fail' || stateOf(report, 'token') === 'fail') return 'NOT CONFIGURED';
  if (stateOf(report, 'reachable') === 'fail' || stateOf(report, 'round trip') === 'fail') return 'FAILED';
  if (stateOf(report, 'reachable') === 'pass' && stateOf(report, 'round trip') === 'pass') return 'CONNECTED';
  return UNCHECKED;
}

/**
 * The model chip. No endpoint health check exists to run yet, so there is no
 * model to name: naming one would be the exact claim the gate forbids. This
 * becomes a real probe when the model router lands.
 */
export function modelState(): string {
  return 'NOT CONFIGURED';
}
