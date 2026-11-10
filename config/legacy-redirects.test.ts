import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CS_ROUTE_INVENTORY,
  KEPT_ROUTES,
  LEGACY_REDIRECTS,
  PAGE_REDIRECTS,
  UNREACHABLE_ROUTES,
  toNextRedirects,
} from "./legacy-redirects";

const APP_DIR = path.resolve(__dirname, "../app");

/** URL path patterns of every page under app/, route groups removed, dynamic segments written as `*`. */
function collectPagePatterns(dir = APP_DIR, segments: string[] = []): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (!statSync(full).isDirectory()) continue;
    const isGroup = name.startsWith("(") && name.endsWith(")");
    const seg = name.startsWith("[") ? "*" : name;
    const next = isGroup ? segments : [...segments, seg];
    if (existsSync(path.join(full, "page.tsx"))) out.push("/" + next.join("/"));
    out.push(...collectPagePatterns(full, next));
  }
  if (segments.length === 0 && existsSync(path.join(dir, "page.tsx"))) out.push("/");
  return out;
}

function pageExists(url: string, patterns: string[]): boolean {
  const target = url.split("?")[0].split("/").filter(Boolean).map((s) => (s.startsWith(":") ? "*" : s));
  return patterns.some((p) => {
    const segs = p.split("/").filter(Boolean);
    return segs.length === target.length && segs.every((s, i) => s === "*" || target[i] === "*" || s === target[i]);
  });
}

/**
 * Pages the route map promises but that are not built yet. Phase 4 shrinks this list; the test below fails if a
 * page is listed here after it exists, so the list cannot go stale.
 */
const PENDING_PAGES: string[] = [
  "/analytics/accuracy-compare",
  "/analytics/accuracy-verification",
  "/analytics/match-prediction",
  "/analytics/performance-reliability",
  "/analytics/robot-radar",
];

describe("legacy redirect table", () => {
  it("covers every CS route exactly once (redirect, kept, page redirect or unreachable)", () => {
    const redirected = new Set(LEGACY_REDIRECTS.map((r) => r.from));
    const kept = new Set(KEPT_ROUTES);
    const pageRedirects = new Set(PAGE_REDIRECTS);
    const unreachable = new Set(UNREACHABLE_ROUTES.map((r) => r.path));
    const missing = CS_ROUTE_INVENTORY.filter((r) => !redirected.has(r) && !kept.has(r) && !pageRedirects.has(r) && !unreachable.has(r));
    expect(missing).toEqual([]);
  });

  it("does not claim routes that are not in the CS inventory", () => {
    const inventory = new Set(CS_ROUTE_INVENTORY);
    const stray = [...LEGACY_REDIRECTS.map((r) => r.from), ...KEPT_ROUTES].filter((r) => !inventory.has(r));
    expect(stray).toEqual([]);
  });

  it("never keeps a route that it also redirects", () => {
    const redirected = new Set(LEGACY_REDIRECTS.filter((r) => !r.whenQuery).map((r) => r.from));
    expect(KEPT_ROUTES.filter((r) => redirected.has(r))).toEqual([]);
  });

  it("puts a conditional row before the plain row for the same path", () => {
    LEGACY_REDIRECTS.forEach((row, i) => {
      if (row.whenQuery) return;
      const conditionalAfter = LEGACY_REDIRECTS.slice(i + 1).some((r) => r.from === row.from && r.whenQuery);
      expect(conditionalAfter, row.from).toBe(false);
    });
  });

  it("has no redirect chains or loops (a destination is never itself redirected)", () => {
    const sources = new Set(LEGACY_REDIRECTS.map((r) => r.from.split("?")[0]));
    for (const r of LEGACY_REDIRECTS) {
      const dest = r.to.split("?")[0];
      expect(sources.has(dest), `${r.from} -> ${r.to}`).toBe(false);
    }
  });

  it("forwards every dynamic segment into the destination", () => {
    for (const r of LEGACY_REDIRECTS) {
      const params = r.from.match(/:\w+/g) ?? [];
      for (const p of params) expect(r.to.includes(p), `${r.from} -> ${r.to}`).toBe(true);
    }
  });

  it("only redirects to pages that exist (or are listed as pending)", () => {
    const patterns = collectPagePatterns();
    const targets = [...new Set([...LEGACY_REDIRECTS.map((r) => r.to), ...KEPT_ROUTES])];
    const unresolved = targets.filter((t) => !pageExists(t, patterns));
    expect(unresolved.sort()).toEqual([...PENDING_PAGES].sort());
  });

  it("produces permanent Next redirects with the query condition on the lead-scout row", () => {
    const next = toNextRedirects();
    expect(next.every((r) => r.permanent)).toBe(true);
    const lead = next.find((r) => r.destination === "/lead-scout-form");
    expect(lead?.has).toEqual([{ type: "query", key: "lead", value: "1" }]);
  });
});
