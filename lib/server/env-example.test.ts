import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ENV_VARS, type EnvGroup } from "./env";

/** The assignment lines of `.env.example` (`NAME=`), with the section (A, B or C) each sits under. */
function parseExample(): { name: string; section: string }[] {
  const text = readFileSync(path.resolve(__dirname, "../../.env.example"), "utf8");
  let section = "";
  const out: { name: string; section: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const header = /^# \(([ABC])\) /.exec(line);
    if (header) section = header[1];
    const assign = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (assign) out.push({ name: assign[1], section });
  }
  return out;
}

const SECTION_OF_GROUP: Record<EnvGroup, string> = { cs: "A", required: "B", optional: "C" };

describe(".env.example", () => {
  const listed = parseExample();

  it("lists exactly the names in ENV_VARS, each once", () => {
    const names = listed.map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(ENV_VARS.map((v) => v.name).sort());
  });

  it("puts each variable in the section for its group", () => {
    for (const v of ENV_VARS) {
      expect(listed.find((l) => l.name === v.name)?.section, v.name).toBe(SECTION_OF_GROUP[v.group]);
    }
  });

  it("holds placeholders only: every value is empty", () => {
    const text = readFileSync(path.resolve(__dirname, "../../.env.example"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const assign = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
      if (assign) expect(assign[2], assign[1]).toBe("");
    }
  });

  it("leaves out the variables this app deliberately does not read", () => {
    const names = listed.map((l) => l.name);
    for (const absent of ["MIGRATION_EMAIL", "MIGRATION_PASSWORD", "TBA_KEY_ENCRYPTION_SECRET", "TBA_API_KEY"]) expect(names).not.toContain(absent);
  });
});
