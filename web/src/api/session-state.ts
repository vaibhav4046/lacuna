export interface Session {
  readonly email: string;
  /** Opaque, non-secret identifier for this exact login session. */
  readonly binding: string;
  /** Null until a workspace exists. Never a placeholder name. */
  readonly workspace: string | null;
  readonly onboarded: boolean;
}

export type SessionState = { readonly signedIn: false } | { readonly signedIn: true; readonly session: Session };
