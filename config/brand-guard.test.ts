import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard: CompSocrates is one site with two programs (FRC and FTC). Each program's names live behind the program layer
 * (`config/programs/<id>.ts` plus the program's own scoped files); shared code reads `ProgramConfig`.
 *
 *   0. THE TEST RULE (read this before adding an allowlist entry). A test or fixture file may use program ids and
 *      program names as DATA: it renders a screen under each program id, builds `programs/<id>/...` paths, asserts that
 *      one program's behavior is unchanged. So every `*.test.ts(x)`, `*.spec.*`, `*.e2e.ts(x)`, `e2e/**`, `app/e2e/**`
 *      (the Playwright fixture pages) and fixture folder (`fixtures/`, `__fixtures__/`, `test-stubs/`) is exempt from
 *      the FTC-name rules (TEST_DATA below), in every scope. Do NOT list a test file in FTC_ALLOWED: it is redundant
 *      and the guard fails on such an entry. The rule covers FTC names only. The sister app's name is never exempt,
 *      tests included. What stays strict is non-test SOURCE: shipped code and the user-visible strings in it.
 *   1. FTC NAMES (the program's short and full name, API host and variables, its game, its multi-team model) may appear,
 *      in non-test source, only in FTC-scoped files (FTC_SCOPE) or in a file listed in FTC_ALLOWED with a reason (a
 *      shared file that IS the program seam, a route that hands off to FTC code, a script that names programs on
 *      purpose). They may NEVER appear in non-test source of an FRC-scoped file (FRC_SCOPE), which is also where the
 *      user-visible FRC strings (brand and program config) live. Shared source stays program-neutral: reword a comment
 *      instead of allowlisting it. `docs/` is not scanned for them: a doc may name either program, it ships nothing.
 *   2. CE NAMES (the old sister app: its name, brand, domain and project ids all contain the same stem, plus its program
 *      switch variable) may appear only in the files listed in CE_ALLOWED: a few docs that describe the history, and the
 *      one-time migration script with its pure rules. Never in an FRC-scoped file, and never in a test.
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
  "lib/memberships/model.ts": "the membership model: names the stored per-member robot-team list once (the stored field is part of the membership document); every other shared file goes through this model and the program config",
  "lib/server/live-program.ts": "the one server place that maps a program id to its live and lobby data store, and validates the program a live route is asked for",
  "app/api/ftc/templates/route.ts": "the server route for form templates of an FTC account; hands the call to the FTC-scoped server module",
  "config/platform.ts": "platform-level footer credit: the one place that names the teams behind both programs (not a program file; the FRC scope stays strict)",
  "app/api/ftc/team/request-join/route.ts": "the server route for asking to join an FTC team; hands the call to the FTC-scoped server module",
  "app/api/ftc/team/sync-field-teams/route.ts": "the server route for Team Settings of an FTC account; hands the call to the FTC-scoped server module",
  "lib/program/data.ts": "the one shared place that maps a program id to its data port",
  "config/programs/types.ts": "the program id list",
  "config/programs/index.ts": "the program registry",
  "firestore.rules": "the FTC rules block",
  // A script is not a test: one that names programs on purpose is listed by name.
  "scripts/audit-event-attendance.ts": "a diagnostic script that names the programs on purpose (its --program flag takes either one)",
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

/**
 * THE TEST RULE: tests and fixtures may use program ids and program names as data (see the header). Never add a test file to FTC_ALLOWED.
 * A folder listed here must hold only tests or fixture data, never shipped code.
 */
const TEST_DATA: RegExp[] = [
  /\.(test|spec)\.[cm]?[jt]sx?$/, // unit, emulator and component tests, specs
  /\.e2e\.tsx?$/, // Playwright specs and the fixture pages named page.e2e.tsx
  /^e2e\//, // Playwright specs and helpers
  /^app\/e2e\//, // Playwright fixture pages (routes only when E2E_THEME_CHECK=1)
  /(^|\/)(fixtures?|__fixtures__|test-stubs)\//, // fixture folders
];
const isTestData = (file: string) => TEST_DATA.some((re) => re.test(file));
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
      if (isTestData(file)) return true; // the test rule: program ids and names are data in a test or fixture
      if (inFrcScope(file)) return false; // never in non-test source, whatever the lists say
      return DOCS.test(file) || inFtcScope(file) || file in FTC_ALLOWED;
    case "ce":
      if (inFrcScope(file)) return false;
      return file in CE_ALLOWED || CE_MIGRATION.some((re) => re.test(file));
    case "frc":
      // Only FTC source files: an FTC-scoped TEST may name FRC to assert that FRC is unchanged (a program id, "FRC is unchanged").
      return !inFtcScope(file) || isTestData(file);
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
        if (group === "ftc" && isTestData(file)) problems.push(`${name}: ${file} is a test or fixture file, exempt by the test rule; remove it`);
        if (group === "ce" && isTestData(file)) problems.push(`${name}: ${file} is a test or fixture file; the sister app's name is never exempt, even in tests`);
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

  it("the test rule: a planted FTC string fails in non-test FRC source and passes in a test, spec, e2e or fixture file", () => {
    for (const source of ["lib/frc/example.ts", "config/programs/frc.ts", "data/cs/example.ts", "config/brand.ts", "components/shared/example.tsx"]) {
      expect(violations(source, planted).length, source).toBeGreaterThan(0);
    }
    for (const test of [
      "lib/frc/example.test.ts",
      "data/cs/example.test.ts",
      "components/shared/example.test.tsx",
      "lib/shared/example.spec.ts",
      "lib/shared/example.emulator.test.ts",
      "e2e/example.e2e.ts",
      "e2e/helpers.ts",
      "app/e2e/example/fixture.tsx",
      "app/e2e/example/page.e2e.tsx",
      "lib/shared/fixtures/example.ts",
    ]) {
      expect(violations(test, planted), test).toEqual([]);
    }
  });

  it("the test rule goes by file name: a lookalike name is still source", () => {
    expect(violations("lib/shared/test-helper.ts", planted).length).toBeGreaterThan(0);
    expect(violations("lib/shared/contest.tsx", planted).length).toBeGreaterThan(0);
    expect(violations("components/e2e-badge.tsx", planted).length).toBeGreaterThan(0);
  });

  it("the sister app's name is never exempt, not even in a test, a fixture or e2e", () => {
    for (const file of ["lib/shared/example.test.ts", "lib/frc/example.test.ts", "e2e/example.e2e.ts", "app/e2e/example/fixture.tsx", "lib/shared/fixtures/example.ts", "components/shared/example.tsx"]) {
      expect(violations(file, plantedCe).length, file).toBeGreaterThan(0);
    }
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
