import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard: this is a FIRST Robotics Competition (FRC) app. Nothing in the source may name or call the other FIRST program's
 * data service, read one of its variables or say its name. The forbidden strings are assembled from pieces so this file can
 * list them without containing them, and the file itself is skipped anyway.
 */

const ROOT = path.resolve(__dirname, "../..");
const DIRS = ["app", "components", "lib", "config", "data"];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".css", ".json"]);
const SELF = path.resolve(__filename);

const program = ["F", "T", "C"].join("");
const lower = program.toLowerCase();

const FORBIDDEN: { label: string; pattern: RegExp }[] = [
  { label: "an FTC API host", pattern: new RegExp(`${lower}-api`, "i") },
  { label: "an FTC events host", pattern: new RegExp(`${lower}-events`, "i") },
  { label: "an FTC_ variable", pattern: new RegExp(`\\b${program}_[A-Z0-9_]+`) },
  { label: "the old program switch", pattern: new RegExp(`EVENT_${"PROGRAM"}`) },
  { label: 'the phrase "FIRST Tech"', pattern: new RegExp(`FIRST ${"Tech"}`, "i") },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...sourceFiles(full));
    else if (EXTENSIONS.has(path.extname(entry)) && full !== SELF) out.push(full);
  }
  return out;
}

describe("no FTC left in the source", () => {
  const files = DIRS.flatMap((d) => sourceFiles(path.join(ROOT, d)));

  it("scans a real set of files", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  for (const { label, pattern } of FORBIDDEN) {
    it(`finds no ${label}`, () => {
      const hits: string[] = [];
      for (const file of files) {
        const lines = readFileSync(file, "utf8").split(/\r?\n/);
        lines.forEach((line, i) => {
          if (pattern.test(line)) hits.push(`${path.relative(ROOT, file).split(path.sep).join("/")}:${i + 1}: ${line.trim().slice(0, 120)}`);
        });
      }
      expect(hits, hits.join("\n")).toEqual([]);
    });
  }
});
