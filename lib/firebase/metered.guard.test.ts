// GUARD: every browser read goes through lib/firebase/metered so the read meter sees it. A new file that imports getDocs, getDoc or onSnapshot straight from
// "firebase/firestore" fails here; import them from "@/lib/firebase/metered" instead (it re-exports everything else unchanged).
import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SOURCE_DIRS = ["app", "components", "lib", "data", "config"];
const READS = /\b(getDocs|getDoc|onSnapshot)\b/;
const IMPORT = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*"firebase\/firestore"/g;

function* sources(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && e.name !== ".next") yield* sources(p);
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) yield p;
  }
}

describe("browser reads go through lib/firebase/metered", () => {
  it("no source file imports getDocs, getDoc or onSnapshot directly from firebase/firestore", () => {
    const offenders: string[] = [];
    for (const dir of SOURCE_DIRS) {
      for (const file of sources(join(ROOT, dir))) {
        const rel = file.slice(ROOT.length + 1).split(sep).join("/");
        if (rel === "lib/firebase/metered.ts") continue;
        const text = readFileSync(file, "utf8");
        for (const m of text.matchAll(IMPORT)) if (!m[1] && READS.test(m[2])) offenders.push(rel);
      }
    }
    expect(offenders, 'import these from "@/lib/firebase/metered"').toEqual([]);
  });

  it("the wrapper module re-exports the rest of firebase/firestore and wraps exactly the three reads", () => {
    const text = readFileSync(join(ROOT, "lib/firebase/metered.ts"), "utf8");
    expect(text).toContain('export * from "firebase/firestore"');
    for (const name of ["getDocs", "getDoc", "onSnapshot"]) expect(text).toMatch(new RegExp(`export const ${name} =`));
  });
});
