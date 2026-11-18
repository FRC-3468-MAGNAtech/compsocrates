"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { storageKey } from "@/config/brand";
import { publicConfigOnce } from "@/lib/memberships/client";
import { usePermissions } from "@/lib/permissions";
import { displayKey, totalOf } from "@/lib/read-meter/model";
import { pageLoadCounts, setLocalMeterOn, setServerMeterOn, subscribeMeter } from "@/lib/read-meter/client";
import { startMeterFlushing } from "@/lib/read-meter/flush";

// Mounted once in the signed-in shell. It renders nothing unless this device's admin counter is on.
//  - The server switch (appSettings/global.readMeterEnabled) is learned from the public config the shell already fetches once per page load: no extra request. OFF
//    (missing) means no counting, no timer and no network at all.
//  - The device counter is for admins only: open any page with `?readmeter=1` once to turn it on for this browser, `?readmeter=0` to turn it off. It counts the documents
//    THIS page load has read, in memory, and sends nothing anywhere.
const OVERLAY_KEY = () => storageKey("readMeterOverlay");

function readOverlayFlag(): boolean {
  try {
    return window.localStorage.getItem(OVERLAY_KEY()) === "1";
  } catch {
    return false;
  }
}

export function ReadMeterBridge() {
  const { isAdmin, isPlatformOwner } = usePermissions();
  const canSee = isAdmin || isPlatformOwner;
  const [overlayOn, setOverlayOn] = useState(false);

  useEffect(() => {
    let alive = true;
    let stop: (() => void) | null = null;
    void publicConfigOnce().then((config) => {
      if (!alive || config?.readMeterEnabled !== true) return;
      setServerMeterOn(true);
      stop = startMeterFlushing();
    });
    return () => {
      alive = false;
      stop?.();
      setServerMeterOn(false);
    };
  }, []);

  useEffect(() => {
    if (!canSee) {
      setLocalMeterOn(false);
      return;
    }
    try {
      const asked = new URLSearchParams(window.location.search).get("readmeter");
      if (asked === "1") window.localStorage.setItem(OVERLAY_KEY(), "1");
      if (asked === "0") window.localStorage.removeItem(OVERLAY_KEY());
    } catch {
      // storage can be blocked: the counter simply stays off
    }
    const on = readOverlayFlag();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOverlayOn(on);
    setLocalMeterOn(on);
    return () => setLocalMeterOn(false);
  }, [canSee]);

  return canSee && overlayOn ? <ReadMeterOverlay onHide={() => { try { window.localStorage.removeItem(OVERLAY_KEY()); } catch { /* blocked */ } setLocalMeterOn(false); setOverlayOn(false); }} /> : null;
}

function ReadMeterOverlay({ onHide }: { onHide: () => void }) {
  const counts = useSyncExternalStore(subscribeMeter, pageLoadCounts, pageLoadCounts);
  const rows = Object.values(counts).flatMap((byCollection) => Object.entries(byCollection));
  const byCollection = new Map<string, number>();
  for (const [collection, n] of rows) byCollection.set(collection, (byCollection.get(collection) ?? 0) + n);
  const top = [...byCollection].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return (
    <div className="glass-strong fixed bottom-3 left-3 z-[var(--z-toast)] max-w-[min(92vw,320px)] rounded-2xl px-3 py-2 text-xs shadow-2xl" role="status" aria-label="Documents read by this page load">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold">Reads this page load: {totalOf(counts).toLocaleString("en-US")}</span>
        <button type="button" className="min-h-[44px] px-2 text-[var(--muted-foreground)] underline" onClick={onHide}>
          Hide
        </button>
      </div>
      {top.length > 0 && (
        <ul className="mt-1 text-[var(--muted-foreground)]">
          {top.map(([collection, n]) => (
            <li key={collection} className="tabular-nums">
              {n.toLocaleString("en-US")} {displayKey(collection)}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-[var(--muted-foreground)]">This device only. Rule-evaluation reads are not counted.</p>
    </div>
  );
}
