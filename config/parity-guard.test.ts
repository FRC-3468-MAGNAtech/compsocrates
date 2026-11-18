import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard: FRC and FTC share ONE page and ONE set of components per feature; a program supplies data and config only (docs/PARITY_REPORT.md).
 *   1. A page or component never compares the program id (`program === ...`, `config.id === ...`): it asks `ProgramConfig`.
 *   2. A page or component may read `useProgramData()` (the data port) only if it is listed below with the reason. That hook is the one door through
 *      which a program can swap what is rendered, so every use is a reviewed choice. A NEW use fails this test: read a config flag, or give both
 *      programs the same UI, or add the file here with a reason and a line in docs/PARITY_RESULTS.md.
 * Manual check when this is not enough: open the same page in /frc/... and /frc -> /ftc/... side by side (docs/PARITY_RESULTS.md).
 */

const ROOT = path.resolve(__dirname, "..");
const SCAN = ["app", "components"];

/** path -> why this file reads the data port. Rendering must stay identical; only the data source may differ. */
const PORT_READERS: Record<string, string> = {
  "app/(app)/[program]/analytics/match-scout/page.tsx": "own-entry store: who may import CSV / recalculate accuracy (a permission, not a layout)",
  "app/(app)/[program]/changelog/page.tsx": "mark-seen: stamps lastSeenChangelogAt on the program's own user document through its port (the entries themselves come from the one platform feed)",
  "app/(app)/[program]/practice-scouting/page.tsx": "own session store: placeholder video and the unreadable-sessions notice (accepted FTC-only)",
  "app/(app)/[program]/scout/page.tsx": "own entry store for accuracy recompute",
  "components/admin/backups-panel.tsx": "which export runs (the program's own collections, team-scoped) and the form used for CSV columns when a team has no entries; the panel is shared",
  "components/admin/rescore-panel.tsx": "a program with its own session/entry store keeps admins' flag dismissals and never replaces a recorded accuracy with a missing one; the library refresh goes through the program's port (data, not layout)",
  "components/analytics/import-csv-dialog.tsx": "which import engine runs; the preview component is shared",
  "components/practice/live/live-results-screen.tsx": "live results data source",
  "components/practice/match-select.tsx": "a match with no video uses the timer placeholder (data, not layout)",
  "components/practice/session-screen.tsx": "built-in match form with alliance roles",
  "components/program/program-auth.tsx": "supplies the program's own profile",
  "components/team/account-teams-section.tsx": "its writes (add, rename, remove, assign) and the team-name lookup go through the program's port; shown only where the program has several teams per account (ProgramConfig.multiTeam)",
  "components/team/join-requests-panel.tsx": "which source the same panel reads",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      walk(rel, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|smoke\.test|e2e)\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}

const files = SCAN.flatMap((d) => walk(d)).filter((f) => !f.startsWith("app/e2e/") && !f.startsWith("app/api/"));
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

describe("FRC/FTC parity guard", () => {
  it("no page or component compares the program id", () => {
    const hits = files.filter((f) => /\b(program|programId|config\.id|programConfig\.id)\s*[!=]==\s*["'`](frc|ftc)["'`]/.test(read(f)) || /\bisFtc\b|\bisFrc\b/.test(read(f)));
    expect(hits, "ask ProgramConfig instead of comparing the program id").toEqual([]);
  });

  it("every file that reads the data port is listed with its reason (a new one is a review decision)", () => {
    const readers = files.filter((f) => /\buseProgramData\(/.test(read(f)));
    const unlisted = readers.filter((f) => !(f in PORT_READERS));
    expect(unlisted, "add the file to PORT_READERS with a reason, or drive the difference from ProgramConfig").toEqual([]);
  });

  it("the list has no stale entries", () => {
    const readers = new Set(files.filter((f) => /\buseProgramData\(/.test(read(f))));
    expect(Object.keys(PORT_READERS).filter((f) => !readers.has(f))).toEqual([]);
  });
});
