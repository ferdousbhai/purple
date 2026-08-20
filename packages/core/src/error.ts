/** Decode the value a `catch` produced into a user-facing message. */
export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
