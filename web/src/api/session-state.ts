export interface Session {
  readonly email: string;
  /** Null until a workspace exists. Never a placeholder name. */
  readonly workspace: string | null;
  readonly onboarded: boolean;
}

export type SessionState = { readonly signedIn: false } | { readonly signedIn: true; readonly session: Session };
