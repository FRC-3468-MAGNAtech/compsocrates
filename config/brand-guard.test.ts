import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard: CompSocrates is one site with two programs (FRC and FTC). Each program's names live behind the program layer
 * (`config/programs/<id>.ts` plus the program's own scoped files); shared code reads `ProgramConfig`.
 *
 *   1. FTC NAMES (the program's short and full name, API host and variables, its game, its multi-team model) may appear
 *      only in FTC-scoped files (FTC_SCOPE) or in a file listed in FTC_ALLOWED with a reason. They may NEVER appear in an
 *      FRC-scoped file (FRC_SCOPE), which is also where the user-visible FRC strings (brand and program config) live.
 *      `docs/` is not scanned for them: a doc may name either program, it ships nothing to a user.
 *   2. CE NAMES (the old sister app: its name, brand, domain and project ids all contain the same stem, plus its program
 *      switch variable) may appear only in the files listed in CE_ALLOWED: a few docs that describe the history, and the
 *      one-time migration script with its pure rules. Never in an FRC-scoped file.
 *   3. FTC-scoped SOURCE files must not name the FRC program's data sources or short name (the programs do not see each
 *      other). FTC-scoped tests may: they assert that FRC is unchanged and pass its program id.
 *
 * The forbidden words are assembled from pieces so this file can list them without being a hit itself (it is also skipped).
 * Any exception goes in a list below with its reason, so it is a deliberate and reviewed choice. Never allow a pattern
 * (a folder or a glob) outside FTC_SCOPE: it would hide the next leak. Name the file.
 */

const ROOT = path.resolve(__dirname, "..");
const SELF = path.relative(ROOT, __filename).split(path.sep).join("/");

/** Files that belong to the FTC program: they may name FTC terms and must not name FRC ones. */
const FTC_SCOPE: RegExp[] = [/^config\/programs\/ftc\.ts$/, /^config\/games\/ftc\//, /^lib\/ftc\//, /^data\/ftc\//, /^scripts\/migrate-ce-to-ftc/, /^docs\/ftc\//];

/** Files that belong to the FRC program, plus the user-visible brand and event copy: they may never name FTC or CE terms. */
const FRC_SCOPE: RegExp[] = [/^config\/programs\/frc\.ts$/, /^config\/games\/(?!ftc\/)/, /^lib\/frc\//, /^data\/cs\//, /^config\/(brand|event|event-names|alliance|cs)(\.test)?\.ts$/];

/** Folder whose files are not scanned for FTC names (they are written for maintainers; CE names are still checked). */
const DOCS = /^docs\//;

/** path -> why this file may name FTC terms. Keep it as small as possible. */
const FTC_ALLOWED: Record<string, string> = {
  // Documentation at the root and config
  "CLAUDE.md": "documents both programs and the sibling read-only reference folders",
  ".env.example": "lists the per-program environment variables",
  // Shared source that maps a program id or an FTC provider (the program seam itself)
  "lib/server/env.ts": "the one reader of environment variables, including the FTC ones",
  "lib/events/actions.ts": "dispatches event data calls to the FTC provider",
  "lib/events/matches-internal.ts": "the session-less match fetch: dispatches to the FTC provider like actions.ts (live-score poller)",
  "lib/server/live-program.ts": "the one server place that maps a program id to its live and lobby data store, and validates the program a live route is asked for",
  "app/api/ftc/templates/route.ts": "the server route for form templates of an FTC account; hands the call to the FTC-scoped server module",
  "app/api/ftc/templates/route.test.ts": "tests that route's token checks and an admin success",
  "config/platform.ts": "platform-level footer credit: the one place that names the teams behind both programs (not a program file; the FRC scope stays strict)",
  "lib/events/event-key.test.ts": "asserts the season-code key shape of the FTC program config and that an FTC key never collides with an FRC key",
  "lib/events/event-queries.test.ts": "asserts an FTC event reads the FTC provider and an FRC event the FRC one (mocked providers)",
  "components/events/event-page.parity.test.tsx": "renders the one event page under each program id and checks the FTC wording, key shape and credit",
  "components/admin/match-library-panel.shared.test.tsx": "renders the one Match Library panel under each program id and a port stub (2 and 3 team columns)",
  "components/practice/lobby/lobby-results-screen.test.tsx": "renders the one lobby results screen under each program id (a match with no official score)",
  "lib/admin/backup.test.ts": "tests the backup export through the FTC program's port and program id",
  "lib/admin/rescore-5b.test.ts": "tests the rescore writers with the FTC program id (paths, partial failure)",
  "lib/forms/active-form-roles.test.ts": "tests that an active form keeps the FTC game's alliance-role block (FTC port and game id)",
  "lib/forms/firestore-store.test.ts": "tests the forms store's paths for the FTC program id and the FTC game's season id",
  "lib/library/adapter.test.ts": "tests that the default library adapter touches no FTC path",
  "lib/templates/firestore-service.test.tsx": "tests the templates service under the FTC program id (paths, API route)",
  "app/api/ftc/team/request-join/route.ts": "the server route for asking to join an FTC team; hands the call to the FTC-scoped server module",
  "app/api/ftc/team/sync-field-teams/route.ts": "the server route for Team Settings of an FTC account; hands the call to the FTC-scoped server module",
  "app/api/ftc/team/sync-field-teams/route.test.ts": "tests that route's token checks and an admin success",
  "lib/changelog/store.test.ts": "tests the changelog store's paths for the default program and for the FTC program",
  "lib/program/data.ts": "the one shared place that maps a program id to its data port",
  "config/programs/types.ts": "the program id list",
  "config/programs/index.ts": "the program registry",
  "firestore.rules": "the FTC rules block",
  // Tests and e2e: a legitimate FTC-program test case or program id in a path
  "firestore.rules.test.ts": "tests the FTC rules block",
  "lib/program/paths.test.ts": "uses the program id as a path segment",
  "lib/server/env-example.test.ts": "maps the env groups to the .env.example sections",
  "lib/sidebar/resolve.test.ts": "tests the sidebar resolver for each program id (hidden pages differ by program)",
  "lib/sidebar/store.emulator.test.ts": "tests the sidebar config rules and save for both programs' paths",
  "components/admin/sidebar-panel.test.tsx": "renders the customizer for each program id",
  "config/parity-guard.test.ts": "the parity guard names both program ids and lists the files that still read a program's data port",
  "components/practice/practice-parity.test.tsx": "renders the shared practice screens under each program id",
  "components/assignments/schedule-grid.test.tsx": "renders the schedule grid under each program id (2 and 3 slots)",
  "e2e/sidebar-builder.e2e.ts": "clicks the sidebar Sync card, whose buttons name the other program",
  "app/e2e/sidebar-builder/fixture.tsx": "the e2e fixture for the sidebar Sync card, which is given the other program's name",
  "lib/scroll-reset.test.ts": "uses an /ftc/ path to test the scroll reset on a program route",
  "lib/analytics/csv-import.test.ts": "tests CSV import for the FTC program's own port and game",
  "lib/analytics/recompute.test.ts": "tests the accuracy recompute under the FTC program id with the FTC game's form id",
  "lib/analytics/event-defaults.test.ts": "tests the default-event rule over the FTC program's own game list (the same rule as FRC's)",
  "lib/events/event-games.test.ts": "tests Event Select's game list for the FTC program next to the FRC one",
  "lib/scout-stats/actions.test.ts": "tests the scout stats actions under the FTC program id",
  "lib/scout-stats/engine-program.test.ts": "tests the stats engine with FTC seasons and the FTC game's alliance roles",
};

/** path -> why this file may name CE terms (its name, brand, domain, project ids). Docs and the migration only. */
const CE_ALLOWED: Record<string, string> = {
  "CLAUDE.md": "names the sibling read-only reference folder and the pre-removal tag",
  "docs/MERGE_PLAN.md": "the merge plan names both apps",
  "docs/ENVIRONMENT.md": "lists the migration script's source variables",
  "docs/FTC_COMPLETION_PLAN.md": "the FTC audit names the sister app it was ported from",
};

/** The one-time migration from the old app's data (the script and its pure rules) may name it without being listed. */
const CE_MIGRATION = [/^scripts\/migrate-ce-to-ftc/, /^lib\/ftc\/migration(\.test)?\.ts$/];

const TEST_FILE = /\.(test|e2e)\.tsx?$/;
const inFtcScope = (file: string) => FTC_SCOPE.some((re) => re.test(file));
const inFrcScope = (file: string) => FRC_SCOPE.some((re) => re.test(file));

const join = (...parts: string[]) => parts.join("");
const FTC = join("F", "T", "C");

type Group = "ftc" | "ce" | "frc";
interface Rule {
  label: string;
  group: Group;
  pattern: RegExp;
}

const RULES: Rule[] = [
  { label: "the old game", group: "ftc", pattern: new RegExp(join("bio", "buzz"), "i") },
  { label: "the other FIRST program (short name)", group: "ftc", pattern: new RegExp(`\\b${FTC}\\b`, "i") },
  { label: "the other FIRST program (FTC_ variable)", group: "ftc", pattern: new RegExp(`\\b${FTC}_[A-Z0-9_]+`) },
  { label: "the other FIRST program (API or events host)", group: "ftc", pattern: new RegExp(`\\b${join("f", "t", "c")}-(api|events)`, "i") },
  { label: "the other FIRST program (full name)", group: "ftc", pattern: new RegExp(join("FIRST ", "Tech"), "i") },
  { label: "the old program switch", group: "ftc", pattern: new RegExp(join("EVENT_", "PROGRAM")) },
  { label: "the multi-team model", group: "ftc", pattern: new RegExp(`${join("field", "[ _-]?", "team")}`, "i") },
  // The sister app's name is also the stem of its brand, domain, storage prefix and project ids.
  { label: "the sister app's name, brand, domain or project id", group: "ce", pattern: new RegExp(join("epic", "urus"), "i") },
  // Used on FTC-scoped files only.
  { label: "the FRC program's short name", group: "frc", pattern: new RegExp(`\\b${join("F", "R", "C")}\\b`, "i") },
  { label: "the FRC program's stats provider", group: "frc", pattern: new RegExp(join("stat", "botics"), "i") },
  { label: "the FRC program's events provider (short name)", group: "frc", pattern: new RegExp(`\\b${join("T", "B", "A")}\\b`) },
  { label: "the FRC program's events provider (full name)", group: "frc", pattern: new RegExp(join("Blue ", "Alliance"), "i") },
];

/** May this file name this rule's terms? (Pure: the real scan and the guard's own tests both use it.) */
function isExempt(rule: Rule, file: string): boolean {
  switch (rule.group) {
    case "ftc":
      if (inFrcScope(file)) return false; // never, whatever the lists say
      return DOCS.test(file) || inFtcScope(file) || file in FTC_ALLOWED;
    case "ce":
      if (inFrcScope(file)) return false;
      return file in CE_ALLOWED || CE_MIGRATION.some((re) => re.test(file));
    case "frc":
      // Only FTC source files: an FTC-scoped TEST may name FRC to assert that FRC is unchanged (a program id, "FRC is unchanged").
      return !inFtcScope(file) || TEST_FILE.test(file);
  }
}

/** Every forbidden mention in one file's text: "<file>:<line>: <label>: <text>". */
function violations(file: string, text: string): string[] {
  const out: string[] = [];
  const rules = RULES.filter((r) => !isExempt(r, file));
  if (rules.length === 0) return out;
  text.split(/\r?\n/).forEach((line, i) => {
    for (const r of rules) if (r.pattern.test(line)) out.push(`${file}:${i + 1}: ${r.label}: ${line.trim().slice(0, 120)}`);
  });
  return out;
}

const SKIP_FILES = new Set(["package-lock.json"]);
const SKIP_DIRS = ["node_modules/", ".next/"];
const BINARY_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".icns", ".svg", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".pdf", ".zip", ".gz", ".mp3", ".mp4", ".webm", ".mov"]);

function trackedFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out
    .split("\0")
    .filter(Boolean)
    .filter((f) => f !== SELF && !SKIP_FILES.has(f) && !SKIP_DIRS.some((d) => f.startsWith(d) || f.includes(`/${d}`)) && !BINARY_EXT.has(path.extname(f).toLowerCase()));
}

function readText(file: string): string | null {
  let buf: Buffer;
  try {
    buf = readFileSync(path.join(ROOT, file));
  } catch {
    return null; // listed by git but deleted in the working tree
  }
  return buf.includes(0) ? null : buf.toString("utf8"); // a NUL byte means binary
}

describe("brand guard: each program's names stay behind the program layer", () => {
  const files = trackedFiles();
  const texts = new Map<string, string>();
  for (const f of files) {
    const t = readText(f);
    if (t !== null) texts.set(f, t);
  }

  it("scans a real set of files", () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it("every allowed exception is a tracked file with a reason, outside the FRC scope, and still needs it", () => {
    const lists: [string, Record<string, string>, Group][] = [
      ["FTC_ALLOWED", FTC_ALLOWED, "ftc"],
      ["CE_ALLOWED", CE_ALLOWED, "ce"],
    ];
    const problems: string[] = [];
    for (const [name, list, group] of lists) {
      for (const [file, reason] of Object.entries(list)) {
        if (reason.trim().length === 0) problems.push(`${name}: ${file} needs a reason`);
        if (!files.includes(file)) problems.push(`${name}: ${file} is allowed but not tracked`);
        if (inFrcScope(file)) problems.push(`${name}: ${file} is in the FRC scope and may not be allowed`);
        const text = texts.get(file);
        const needs = text !== undefined && text.split(/\r?\n/).some((line) => RULES.some((r) => r.group === group && r.pattern.test(line)));
        if (text !== undefined && !needs) problems.push(`${name}: ${file} no longer names anything forbidden; remove it`);
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  for (const group of ["ftc", "ce"] as const) {
    for (const rule of RULES.filter((r) => r.group === group)) {
      it(`finds no mention of ${rule.label} outside its files`, () => {
        const hits: string[] = [];
        for (const [file, text] of texts) {
          if (isExempt(rule, file)) continue;
          text.split(/\r?\n/).forEach((line, i) => {
            if (rule.pattern.test(line)) hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
          });
        }
        expect(hits, hits.join("\n")).toEqual([]);
      });
    }
  }

  it("FTC-scoped files do not name the FRC program's sources", () => {
    const hits: string[] = [];
    for (const [file, text] of texts) {
      if (inFtcScope(file)) hits.push(...violations(file, text).filter((v) => /FRC program/.test(v)));
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("FRC-scoped files name no FTC or CE term, whatever the lists say", () => {
    const hits: string[] = [];
    let seen = 0;
    for (const [file, text] of texts) {
      if (!inFrcScope(file)) continue;
      seen++;
      hits.push(...violations(file, text));
    }
    expect(seen).toBeGreaterThan(10);
    expect(hits, hits.join("\n")).toEqual([]);
  });
});

describe("brand guard: the guard itself", () => {
  const planted = `// ${FTC} scoring: see ${join("bio", "buzz")}`;
  const plantedCe = `// ported from ${join("Comp", "Epic", "urus")}`;

  it("fails a planted FTC string in an FRC file and passes it in an FTC file", () => {
    expect(violations("lib/frc/example.ts", planted).length).toBeGreaterThan(0);
    expect(violations("config/programs/frc.ts", planted).length).toBeGreaterThan(0);
    expect(violations("data/cs/example.ts", planted).length).toBeGreaterThan(0);
    expect(violations("lib/ftc/example.ts", planted)).toEqual([]);
    expect(violations("config/programs/ftc.ts", planted)).toEqual([]);
    expect(violations("data/ftc/example.ts", planted)).toEqual([]);
  });

  it("fails a planted FTC string in an unlisted shared file, passes it in a listed test file and in docs", () => {
    expect(violations("components/shared/example.tsx", planted).length).toBeGreaterThan(0);
    expect(violations("lib/analytics/new-file.ts", planted).length).toBeGreaterThan(0);
    expect(violations("lib/scroll-reset.test.ts", planted)).toEqual([]);
    expect(violations("docs/EXAMPLE_RESULTS.md", planted)).toEqual([]);
  });

  it("an allowlist entry never lifts the rule inside the FRC scope", () => {
    FTC_ALLOWED["lib/frc/example.ts"] = "planted";
    try {
      expect(violations("lib/frc/example.ts", planted).length).toBeGreaterThan(0);
    } finally {
      delete FTC_ALLOWED["lib/frc/example.ts"];
    }
  });

  it("fails a planted CE name anywhere but the allowed docs and the migration", () => {
    expect(violations("components/shared/example.tsx", plantedCe).length).toBeGreaterThan(0);
    expect(violations("lib/ftc/example.ts", plantedCe).length).toBeGreaterThan(0);
    expect(violations("docs/EXAMPLE_RESULTS.md", plantedCe).length).toBeGreaterThan(0);
    expect(violations("lib/frc/example.ts", plantedCe).length).toBeGreaterThan(0);
    expect(violations("docs/MERGE_PLAN.md", plantedCe)).toEqual([]);
    expect(violations("scripts/migrate-ce-to-ftc.ts", plantedCe)).toEqual([]);
  });

  it("fails a planted FRC term in an FTC file but not in an FRC file", () => {
    const frcTerm = `// uses ${join("T", "B", "A")} data`;
    expect(violations("lib/ftc/example.ts", frcTerm).length).toBeGreaterThan(0);
    expect(violations("lib/ftc/example.test.ts", frcTerm)).toEqual([]); // an FTC test may assert FRC is unchanged
    expect(violations("lib/frc/example.ts", frcTerm)).toEqual([]);
    expect(violations("components/shared/example.tsx", frcTerm)).toEqual([]);
  });
});
