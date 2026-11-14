import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard: CompSocrates is one site with two programs (FRC and FTC), and each program's names live behind the program layer.
 *   1. The FTC program's names (its short and full name, API host and variables, game, the sibling app it came from, its
 *      multi-team model) may appear only in FTC-scoped files (FTC_SCOPE) or an ALLOWED file with a stated reason.
 *   2. FTC-scoped files must not name the FRC program's data sources or short name.
 * Everything user-visible comes from `config/brand.ts` and `config/programs/`.
 *
 * The forbidden words are assembled from pieces so this file can list them without being a hit itself (it is also skipped).
 * Any exception goes in ALLOWED below, with the reason, so it is a deliberate and reviewed choice.
 */

const ROOT = path.resolve(__dirname, "..");
const SELF = path.relative(ROOT, __filename).split(path.sep).join("/");

/** Files that belong to the FTC program: they may name FTC terms and must not name FRC ones. */
const FTC_SCOPE: RegExp[] = [/^config\/programs\/ftc\.ts$/, /^config\/games\/ftc\//, /^lib\/ftc\//, /^data\/ftc\//, /^scripts\/migrate-ce-to-ftc/, /^docs\/ftc\//];

/** path -> why this file may name a forbidden term. Keep it as small as possible. */
const ALLOWED: Record<string, string> = {
  "CLAUDE.md": "documents both programs and the sibling read-only reference folders",
  "docs/MERGE_PLAN.md": "the merge plan names both programs",
  "docs/ENVIRONMENT.md": "lists the per-program environment variables",
  "docs/ROUTES.md": "the decision table records the program decisions",
  "docs/REMAINING.md": "lists what is left of the program merge",
  ".env.example": "lists the per-program environment variables",
  "lib/server/env.ts": "the one reader of environment variables, including the FTC ones",
  "lib/events/actions.ts": "dispatches event data calls to the FTC provider",
  "config/programs/types.ts": "the program id list",
  "config/programs/index.ts": "the program registry",
  "lib/program/paths.test.ts": "uses the program id as a path segment",
  "lib/server/env-example.test.ts": "maps the env groups to the .env.example sections",
  "firestore.rules": "the FTC rules block",
  "firestore.indexes.json": "FTC indexes",
  "firestore.rules.test.ts": "tests the FTC rules block",
};

const inFtcScope = (file: string) => FTC_SCOPE.some((re) => re.test(file));

const join = (...parts: string[]) => parts.join("");

const FORBIDDEN: { label: string; pattern: RegExp }[] = [
  { label: "the sibling app's name", pattern: new RegExp(join("epic", "urus"), "i") },
  { label: "the old game", pattern: new RegExp(join("bio", "buzz"), "i") },
  { label: "the other FIRST program (short name)", pattern: new RegExp(`\\b${join("F", "T", "C")}\\b`, "i") },
  { label: "the other FIRST program (FTC_ variable)", pattern: new RegExp(`\\b${join("F", "T", "C")}_[A-Z0-9_]+`) },
  { label: "the other FIRST program (API or events host)", pattern: new RegExp(`\\b${join("f", "t", "c")}-(api|events)`, "i") },
  { label: "the other FIRST program (full name)", pattern: new RegExp(join("FIRST ", "Tech"), "i") },
  { label: "the old program switch", pattern: new RegExp(join("EVENT_", "PROGRAM")) },
  { label: "the multi-team model", pattern: new RegExp(`${join("field", "[ _-]?", "team")}`, "i") },
];

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

describe("brand guard: nothing names the app this one was started from", () => {
  const files = trackedFiles();

  it("scans a real set of files", () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it("every allowed exception is a tracked file that really needs it", () => {
    for (const [file, reason] of Object.entries(ALLOWED)) {
      expect(reason.trim().length, `${file} needs a reason`).toBeGreaterThan(0);
      expect(files, `${file} is allowed but not tracked`).toContain(file);
    }
  });

  for (const { label, pattern } of FORBIDDEN) {
    it(`finds no mention of ${label}`, () => {
      const hits: string[] = [];
      for (const file of files) {
        if (file in ALLOWED || inFtcScope(file)) continue;
        const text = readText(file);
        if (text === null) continue;
        text.split(/\r?\n/).forEach((line, i) => {
          if (pattern.test(line)) hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
        });
      }
      expect(hits, hits.join("\n")).toEqual([]);
    });
  }
});

describe("brand guard: FTC-scoped files do not name the FRC program's sources", () => {
  const FRC_TERMS = [new RegExp(`\b${join("F", "R", "C")}\b`, "i"), new RegExp(join("stat", "botics"), "i"), new RegExp(`\b${join("T", "B", "A")}\b`), new RegExp(join("Blue ", "Alliance"), "i")];

  it("finds none", () => {
    const hits: string[] = [];
    for (const file of trackedFiles().filter(inFtcScope)) {
      const text = readText(file);
      if (text === null) continue;
      text.split(/\r?\n/).forEach((line, i) => {
        if (FRC_TERMS.some((re) => re.test(line))) hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });
});
