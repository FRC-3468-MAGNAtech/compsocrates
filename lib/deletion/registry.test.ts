import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROGRAM_IDS } from "@/config/programs/types";
import { PERSON_DATA_REGISTRY, SHARED_ENTRIES, SHARED_RATE_LIMIT_PREFIXES, siteEntries, type Finder, type RegistryEntry } from "@/lib/deletion/registry";

/**
 * THE GUARD for the person data registry (memberships build 4). Account deletion only works if the registry is complete, so this test fails when:
 *   1. `firestore.rules` names a collection the registry does not cover (a new collection means a new row, even if the row says `none` and why);
 *   2. non-test source names a collection through `programPath` / `programCollection` / `programDoc` / `.collection("x")` and the registry does not cover it;
 *   3. a writer file stores a person-looking field (a key ending in Uid, Email, Name, By, Token) that no registry entry lists and that is not allowlisted
 *      with a reason (heuristic: false positives are possible, see the allowlist; false negatives too: a person stored under an unusual name is not caught).
 * Fix a failure by adding the row to `lib/deletion/registry.ts` (or the program's own list), or an allowlist line below with the reason.
 */
const ROOT = path.resolve(__dirname, "../..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next" || e.name === "e2e") continue;
      walk(rel, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|smoke\.test|e2e)\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(rel);
  }
  return out;
}

const allEntries: RegistryEntry[] = [...PROGRAM_IDS.flatMap((p) => PERSON_DATA_REGISTRY[p]), ...siteEntries()];
const covered = new Set<string>();
for (const e of allEntries) for (const seg of e.collection.split("/")) if (seg !== "*") covered.add(seg);

/** Collections that exist but hold no person, and why. They count as covered. */
const NO_PERSON_DATA: Record<string, string> = {
  libraryMatches: "covered by an entry (createdBy)",
};

describe("registry shape", () => {
  it("every id is unique within a program and every row says why", () => {
    for (const p of PROGRAM_IDS) {
      const ids = PERSON_DATA_REGISTRY[p].map((e) => e.id);
      expect(new Set(ids).size, `duplicate id in ${p}`).toBe(ids.length);
    }
    for (const e of allEntries) expect(e.note.trim().length, e.id).toBeGreaterThan(5);
  });

  it("a rewrite or delete row names the fields it handles and a way to find them", () => {
    for (const e of allEntries) {
      if (e.action === "rewrite" || e.action === "delete") {
        expect(e.finders.length, `${e.id} has no finder`).toBeGreaterThan(0);
        expect(e.fields.length, `${e.id} lists no fields`).toBeGreaterThan(0);
      }
      if (e.action === "rewrite") expect(e.rewrite, `${e.id} has no rewrite spec`).toBeDefined();
    }
  });

  it("every rewritten path is listed in the entry's fields (the list is the documentation)", () => {
    const leaf = (p: string) => p.replace(/\[\]/g, "").split(".").slice(-1)[0];
    for (const e of allEntries) {
      const listed = new Set(e.fields.map((f) => leaf(f)));
      const spec = e.rewrite;
      if (!spec) continue;
      const paths = [...(spec.pairs ?? []).flatMap((p) => [p.uid, ...(p.name ? [p.name] : [])]), ...(spec.uidArrays ?? []), ...(spec.mapKeys ?? []), ...(spec.mapOfArrays ?? []), ...(spec.deleteFields ?? [])];
      for (const emb of spec.embedded ?? []) paths.push(...(emb.spec.pairs ?? []).flatMap((p) => [p.uid, ...(p.name ? [p.name] : [])]), ...(emb.spec.uidArrays ?? []), ...(emb.spec.mapKeys ?? []));
      for (const p of paths) expect(listed.has(leaf(p)), `${e.id}: ${p} is rewritten but not in fields`).toBe(true);
    }
  });

  it("no finder is a collection-group query: every finder kind is path based (the type forbids a group kind)", () => {
    const kinds = new Set<Finder["kind"]>(allEntries.flatMap((e) => e.finders.map((f) => f.kind)));
    for (const k of kinds) expect(["equals", "arrayContains", "equalsKnown", "docId", "idPrefix", "userTree", "perTeamDoc", "perTeamEquals", "teamChildren", "teamDocs", "teamScan", "derived", "namesInTeams"]).toContain(k);
  });

  it("every rate limit prefix ends in an underscore (the range is prefix + uid + underscore)", () => {
    for (const p of SHARED_RATE_LIMIT_PREFIXES) expect(p.endsWith("_")).toBe(true);
  });

  it("the shared list never names a program", () => {
    const text = JSON.stringify(SHARED_ENTRIES.map((e) => ({ ...e, renameId: undefined })));
    expect(/\bftc\b|\bfrc\b/i.test(text)).toBe(false);
  });
});

describe("registry covers every collection", () => {
  it("firestore.rules: every named collection has a row", () => {
    const rules = read("firestore.rules");
    const names = new Set<string>();
    for (const m of rules.matchAll(/match \/([A-Za-z][A-Za-z0-9]*)\//g)) names.add(m[1]);
    for (const m of rules.matchAll(/match \/([A-Za-z][A-Za-z0-9]*)\s*\{/g)) names.add(m[1]);
    for (const skip of ["databases", "programs", "documents"]) names.delete(skip);
    const missing = [...names].filter((n) => !covered.has(n) && !(n in NO_PERSON_DATA));
    expect(missing, "add a registry row (action `none` with a reason if no person is stored)").toEqual([]);
  });

  it("non-test source: every collection named through the path helpers has a row", () => {
    const names = new Map<string, string>();
    const patterns = [
      /programPath\([^,()]+,\s*["'`]([A-Za-z][A-Za-z0-9]*)["'`]/g,
      /programCollection\([^,()]+,\s*["'`]([A-Za-z][A-Za-z0-9]*)["'`]/g,
      /programDoc\([^,()]+,\s*["'`]([A-Za-z][A-Za-z0-9]*)["'`]/g,
      /\.collection\(\s*["'`]([A-Za-z][A-Za-z0-9]*)["'`]\s*\)/g,
    ];
    for (const f of [...walk("lib"), ...walk("data"), ...walk("app/api"), ...walk("components"), ...walk("scripts")]) {
      const text = read(f);
      for (const re of patterns) for (const m of text.matchAll(re)) if (!names.has(m[1])) names.set(m[1], f);
    }
    const missing = [...names].filter(([n]) => !covered.has(n) && !(n in NO_PERSON_DATA)).map(([n, f]) => `${n} (${f})`);
    expect(missing, "add a registry row (action `none` with a reason if no person is stored)").toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The field-name check (heuristic, with an allowlist)
// ---------------------------------------------------------------------------------------------------------------------------------------------

/** Keys that look like a person (Uid, Email, Name, By, Token...) and are listed by some registry row, by their last path segment. */
const registeredFields = new Set<string>();
for (const e of allEntries) for (const f of e.fields) registeredFields.add(f.replace(/\[\]/g, "").split(".").slice(-1)[0]);

const PERSONISH = /^[a-z][A-Za-z0-9]*(Uid|UID|Email|Name|By|Token|Tokens|ById|OwnerId)$|^(uid|scoutId|userId|helperId|authorId|fcmTokens|email|name|displayName|photoURL)$/;

/** Writer files only: they build documents that are stored (not types, readers, components). */
const WRITER_DIRS = ["lib/server", "data/ftc", "data/cs", "lib/ftc"];

/** `file -> { field: reason }`: person-looking keys that are NOT a person's data (a team name, an event name), or are covered by another row. */
const ALLOWED: Record<string, Record<string, string>> = {};
/** `field -> reason` for the same, in any writer file. */
const NOT_A_PERSON: Record<string, string> = {
  teamName: "a team's name",
  eventName: "an event's name",
  formName: "a form's name",
  fieldName: "a form field's name",
  pageName: "a page's name",
  roleName: "a role label",
  seasonName: "a season label",
  gameName: "a game label",
  displayName: "read from the person's own account and shown, or the profile (the profile document is a delete row)",
  name: "a generic name key: team, form, template, event or a person's snapshot (memberships.name is a registered field)",
  teamLabelBy: "unused",
  authorName: "form templates (authorName is registered for the program that stores a person there)",
  actorName: "registered on auditLog and platformAuditLog",
  targetName: "registered on auditLog (target.targetName)",
  email: "registered on users and the join request / application rows; mail helpers only pass it along",
  scoutName: "registered on the entry, session and assignment rows",
  userName: "registered on teamJoinRequests",
  updatedBy: "registered on the rows that store it",
  createdBy: "registered on the rows that store it",
  assignedBy: "registered on the assignment rows",
  uid: "registered on the rows that store it",
  userId: "registered on teamJoinRequests",
  scoutId: "registered on the entry rows",
  fromName: "teamTransfers / pendingTransfer (registered)",
  toName: "teamTransfers / pendingTransfer (registered)",
  ownerName: "an owner shown in a mail or a label, not stored on a document (the team's ownerUid is registered)",
  newOwnerName: "mail template argument",
  userEmail: "registered on teamJoinRequests",
  applicantName: "registered on teamApplications",
  applicantEmail: "registered on teamApplications",
  hostName: "registered on lobbies",
  helperName: "registered on helperReports",
  requestedByName: "registered on subInRequests",
  claimedByName: "registered on subInRequests",
  updatedByName: "registered on pickLists and credits",
  teamLabel: "a team label",
  scopeName: "unused",
  firstName: "unused",
  lastName: "unused",
  clientEmail: "the service account's email in the environment reader, not stored",
  officialName: "a team's official name from the FIRST directory",
  endedBy: "how a membership ended (self, admin, deleted), not a person",
  teamOwnerUid: "a function argument of the guard, not a stored field (ownerUid is registered)",
  templateName: "a mail template argument",
  confirmName: "the typed confirmation of an owner action, not stored",
  matchedName: "a flag inside the deletion engine (in memory), not stored",
  requestedBy: "who asked for a deletion (self or owner) on the job document: a role word, not a person",
  stoppedBy: "why a deletion run stopped (budget, time, cooldown), not a person",
};

describe("registry covers person fields in writers (heuristic)", () => {
  it("a writer stores no person-looking key that no registry row lists", () => {
    const hits: string[] = [];
    for (const dir of WRITER_DIRS) {
      for (const f of walk(dir)) {
        if (/\/test-support\//.test(f)) continue;
        const text = read(f);
        const seen = new Set<string>();
        for (const m of text.matchAll(/(?:^|[{,\s])([a-z][A-Za-z0-9]*)\s*:\s*(?!\s*(?:string|number|boolean|unknown|null|undefined)\b)/gm)) {
          const key = m[1];
          if (!PERSONISH.test(key) || seen.has(key)) continue;
          seen.add(key);
          if (registeredFields.has(key) || key in NOT_A_PERSON || ALLOWED[f]?.[key]) continue;
          hits.push(`${f}: ${key}`);
        }
      }
    }
    expect(hits, "register the field (lib/deletion/registry.ts or the program's deletion-entries.ts), or allowlist it with a reason").toEqual([]);
  });
});
