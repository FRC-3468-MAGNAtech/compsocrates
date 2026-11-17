/** Is this a Firestore "permission denied" (the rules are not deployed, or the reader is not allowed)? */
export function isFirestoreDenied(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === "permission-denied";
}
