"use client";

// The browser half of the read meter: in-memory counters and nothing else. OFF (the default) means `isMeterActive()` is false and every wrapper in
// lib/firebase/metered.ts passes straight through. ON means counts are kept in memory only; the flush (lib/read-meter/flush.ts) sends them to the server.
import { addCount, collectionKeyOf, pageKeyOf, type Counts } from "./model";

let serverOn = false;
let localOn = false;
let pending: Counts = {};
let pageLoad: Counts = {};
const listeners = new Set<() => void>();

/** The switch from the server (appSettings/global.readMeterEnabled, learned from the public config). */
export function setServerMeterOn(on: boolean): void {
  serverOn = on;
}
/** This device's own counter (an admin's overlay): counts for this page load, in memory, never sent anywhere. */
export function setLocalMeterOn(on: boolean): void {
  localOn = on;
  if (!on) pageLoad = {};
  notify();
}
export const isMeterActive = (): boolean => serverOn || localOn;
export const isServerMeterOn = (): boolean => serverOn;

function currentPage(): string {
  try {
    return pageKeyOf(window.location.pathname);
  } catch {
    return "unknown";
  }
}

/** Count `n` documents read from a collection path (a doc's parent). The page is the route open right now. */
export function recordDocs(collectionPath: string, n: number): void {
  if (!isMeterActive() || !(n > 0)) return;
  const page = currentPage();
  const collection = collectionKeyOf(collectionPath);
  if (serverOn) addCount(pending, page, collection, n);
  if (localOn) {
    addCount(pageLoad, page, collection, n);
    notify();
  }
}

/** Hand over what has been counted since the last flush and start again. */
export function takePending(): Counts {
  const out = pending;
  pending = {};
  return out;
}
export const pageLoadCounts = (): Counts => pageLoad;

function notify(): void {
  listeners.forEach((l) => l());
}
export function subscribeMeter(l: () => void): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** Test hook. */
export function resetMeterForTests(): void {
  serverOn = false;
  localOn = false;
  pending = {};
  pageLoad = {};
  listeners.clear();
}
