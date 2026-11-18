"use client";

// Sends the browser's in-memory counts to the server: at most every 10 minutes while the page is open, and when the page is hidden. A failed send is logged and the
// counts are dropped: the meter never breaks the app and never retries in a loop.
import { authedApi } from "@/lib/api-client";
import { isServerMeterOn, takePending } from "@/lib/read-meter/client";
import { totalOf } from "@/lib/read-meter/model";

export const FLUSH_EVERY_MS = 10 * 60 * 1000;

export async function flushMeter(opts: { keepalive?: boolean } = {}): Promise<void> {
  if (!isServerMeterOn()) return;
  const counts = takePending();
  if (totalOf(counts) === 0) return;
  try {
    await authedApi("/api/read-meter", { method: "POST", body: { counts }, keepalive: opts.keepalive, timeoutMs: 15_000 });
  } catch (err) {
    console.warn("read meter flush dropped:", err instanceof Error ? err.message : "unknown error");
  }
}

/** Start the timer and the page-hide hooks. Returns the stop function. */
export function startMeterFlushing(): () => void {
  const timer = setInterval(() => void flushMeter(), FLUSH_EVERY_MS);
  const onHide = () => {
    if (document.visibilityState === "hidden") void flushMeter({ keepalive: true });
  };
  const onPageHide = () => void flushMeter({ keepalive: true });
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onPageHide);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", onPageHide);
  };
}
