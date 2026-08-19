import { HydraConfigError } from '../hydra/errors.js';
import { openSource, readProfile, type Profile } from '../hydra/open.js';

/**
 * Which store this machine reads, and how it was decided.
 *
 * "One context. Any agent." is a claim about where the context lives, so the
 * first question a person has at a terminal is which store they are talking
 * to. This command answers it without asking a question of the store, so it
 * still answers when the store is down.
 *
 * Nothing here prints a URL or a token. The names of a database and a
 * collection are not secrets; the address and the key are.
 */

export interface ProfileReport {
  readonly profile: Profile | 'unconfigured';
  /** `environment` when LACUNA_PROFILE named it, `inferred` when it did not. */
  readonly decidedBy: 'environment' | 'inferred' | 'none';
  readonly store: string;
  readonly available: readonly Profile[];
  readonly problem: string | null;
}

export function runProfile(env: Record<string, string | undefined>): ProfileReport {
  let named: Profile | null = null;
  let problem: string | null = null;
  try {
    named = readProfile(env);
  } catch (error) {
    problem = error instanceof HydraConfigError ? error.message : 'LACUNA_PROFILE is not readable';
  }

  const available: Profile[] = [];
  for (const profile of ['cloud', 'node'] as const) {
    try {
      openSource({ ...env, LACUNA_PROFILE: profile });
      available.push(profile);
    } catch {
      // Not configured on this machine, which is a fact about the machine
      // rather than a failure of this command.
    }
  }

  try {
    const opened = openSource(env);
    return {
      profile: opened.profile,
      decidedBy: named === null ? 'inferred' : 'environment',
      store: opened.describe,
      available,
      problem,
    };
  } catch (error) {
    return {
      profile: 'unconfigured',
      decidedBy: named === null ? 'none' : 'environment',
      store: 'no context store is configured',
      available,
      problem: problem ?? (error instanceof Error ? error.message : 'unreadable configuration'),
    };
  }
}
