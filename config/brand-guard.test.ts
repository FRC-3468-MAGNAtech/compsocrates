import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard: this is CompSocrates, an FRC scouting app. Nothing tracked in the repository may name or imply the sibling app it was
 * started from, its other game programs or its multi-team model: every brand string comes from `config/brand.ts`.
 *
 * The forbidden words are assembled from pieces so this file can list them without being a hit itself (it is also skipped).
 * Any exception goes in ALLOWED below, with the reason, so it is a deliberate and reviewed choice.
 */

const ROOT = path.resolve(__dirname, "..");
const SELF = path.relative(ROOT, __filename).split(path.sep).join("/");

/** path -> why this file may name a forbidden term. Keep it as small as possible. */
const ALLOWED: Record<string, string> = {
  "CLAUDE.md": "names the sibling read-only reference folders",
};

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
        if (file in ALLOWED) continue;
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
