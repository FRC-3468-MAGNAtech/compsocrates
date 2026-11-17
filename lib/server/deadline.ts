/** A request deadline for the membership routes: long enough for a transaction with retries, short enough that a stalled connection cannot hang a request. */
export const ROUTE_DEADLINE_MS = 20_000;

export class DeadlineError extends Error {
  constructor(readonly ms: number) {
    super(`deadline of ${ms} ms exceeded`);
    this.name = "DeadlineError";
  }
}

/** `work`, or a `DeadlineError` when it has not settled in `ms`. The work itself is not cancelled (a transaction may still finish), so the message says "may". */
export async function withDeadline<T>(work: Promise<T>, ms: number = ROUTE_DEADLINE_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new DeadlineError(ms)), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}
