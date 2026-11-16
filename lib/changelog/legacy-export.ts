import path from "node:path";
import { existsSync, realpathSync } from "node:fs";

// Reading the OLD CompSocrates release notes out for the importer (Session 7). Pure helpers: scripts/export-cs-changelog.ts is the only thing that
// touches Firestore, it never runs from the build or the tests, and it can only READ (see `readOnly` below).

/** The old app stored notes in two places: `teams/{id}.versionReleases[]` (the source of truth for team users) and a root `versionReleases` collection. */
export const OLD_TEAMS_COLLECTION = "teams";
export const OLD_ROOT_COLLECTION = "versionReleases";
export const OLD_TEAM_FIELD = "versionReleases";
/** The export key for the root collection's notes (they belong to no team). */
export const GLOBAL_KEY = "global";

type Doc = { id: string; data: Record<string, unknown> };
export type ExportedNote = { id: string; title: string; body: string; createdAt: number; updatedAt: number };

const asMs = (v: unknown): number => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v === "object" && "toMillis" in v && typeof (v as { toMillis: unknown }).toMillis === "function") return (v as { toMillis: () => number }).toMillis();
  return 0;
};

/** ONLY the five fields the importer needs (id, title, body, two times): no author names or uids, and nothing else from a team document. */
function noteFrom(id: string, raw: Record<string, unknown>): ExportedNote {
  return { id, title: typeof raw.title === "string" ? raw.title : "", body: typeof raw.body === "string" ? raw.body : "", createdAt: asMs(raw.createdAt), updatedAt: asMs(raw.updatedAt) };
}

/** The importer's input (`{ teamId: notes[] }`) from the old teams and the old root collection. Teams without notes are left out. */
export function buildExport(teams: Doc[], root: Doc[]): Record<string, ExportedNote[]> {
  const out: Record<string, ExportedNote[]> = {};
  for (const t of teams) {
    const list = t.data[OLD_TEAM_FIELD];
    if (!Array.isArray(list)) continue;
    const notes = list.filter((n): n is Record<string, unknown> => !!n && typeof n === "object").map((n) => noteFrom(typeof n.id === "string" ? n.id : "", n));
    if (notes.length > 0) out[t.id] = notes;
  }
  const globalNotes = root.map((d) => noteFrom(d.id, d.data));
  if (globalNotes.length > 0) out[GLOBAL_KEY] = globalNotes;
  return out;
}

export const exportCounts = (data: Record<string, ExportedNote[]>) => ({
  teams: Object.keys(data).filter((k) => k !== GLOBAL_KEY).length,
  notes: Object.values(data).reduce((n, l) => n + l.length, 0),
  global: data[GLOBAL_KEY]?.length ?? 0,
});

// --- the output path must be OUTSIDE the repository --------------------------------------------------------------------------------------------------

const norm = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);

/** Resolves a path as far as it exists (symlinks followed), so a link into the repository cannot sneak a file in. */
function realish(p: string): string {
  let cur = path.resolve(p);
  const rest: string[] = [];
  while (!existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    rest.unshift(path.basename(cur));
    cur = parent;
  }
  return path.join(existsSync(cur) ? realpathSync(cur) : cur, ...rest);
}

/** Is `target` the repository folder itself, or anywhere inside it? */
export function isInsideRepo(target: string, repoRoot: string): boolean {
  const rel = path.relative(norm(realish(repoRoot)), norm(realish(target)));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Throws unless the path is outside the repository (an export holds the old notes' wording and must never be committed by accident). */
export function assertOutsideRepo(target: string, repoRoot: string): void {
  if (isInsideRepo(target, repoRoot)) throw new Error(`Refusing to write inside the repository (${target}). Give a path outside it, for example a folder in your user profile.`);
}

// --- read-only guard -------------------------------------------------------------------------------------------------------------------------------

const READ_METHODS = new Set(["collection", "doc", "get", "where", "orderBy", "limit", "listDocuments", "getAll"]);

/**
 * Wraps a Firestore object so ONLY reads can run: `collection`, `doc`, `where`, `orderBy`, `limit`, `get`, `listDocuments`, `getAll`. Any other function
 * (set, update, delete, create, batch, runTransaction, bulkWriter, recursiveDelete, add...) throws the moment it is called, before anything is sent.
 * Refs and queries returned by an allowed call are wrapped the same way.
 */
export function readOnly<T extends object>(target: T): T {
  return new Proxy(target, {
    get(obj, prop) {
      const value = Reflect.get(obj, prop);
      if (typeof value !== "function") return value;
      const name = String(prop);
      if (!READ_METHODS.has(name)) {
        return () => {
          throw new Error(`The export is read-only: "${name}" is not allowed.`);
        };
      }
      return (...args: unknown[]) => {
        const result = (value as (...a: unknown[]) => unknown).apply(obj, args);
        // A promise (from get) is returned as it is; a ref or query is wrapped so a write on it throws too.
        if (result && typeof result === "object" && !("then" in result) && !Array.isArray(result)) return readOnly(result as object);
        return result;
      };
    },
  });
}
