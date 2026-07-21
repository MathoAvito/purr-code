/**
 * Thrown when the runtime directory cannot be resolved, created, or verified
 * safely (FR-05 / §13 hardening). Callers on the hook path must catch this and
 * fail silent — never surface it to Claude's transcript.
 */
export class RuntimeDirError extends Error {
  readonly code: RuntimeDirErrorCode;

  constructor(code: RuntimeDirErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RuntimeDirError";
    this.code = code;
  }
}

export type RuntimeDirErrorCode =
  "unresolved" | "not-directory" | "symlink" | "wrong-owner" | "insecure-mode";
