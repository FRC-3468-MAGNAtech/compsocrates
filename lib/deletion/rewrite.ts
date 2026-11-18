import { DELETED_ACCOUNT_NAME } from "@/lib/deletion/constants";
import type { RewriteSpec } from "@/lib/deletion/registry";

/**
 * The pure half of the rewrite step: given ONE document and the registry's spec, what must change so that the person's uid becomes the opaque id and their name
 * "Deleted Account". It returns top-level fields to set (a nested path is rebuilt from a copy of its top-level value) and top-level fields to delete, or null when
 * the document holds nothing of the person. Running it on its own output returns null, so a rewrite is idempotent and a crashed job can simply look again.
 */
type Doc = Record<string, unknown>;
export type RewritePatch = { set: Doc; deleteFields: string[] };

const isPlain = (v: unknown): v is Doc => typeof v === "object" && v !== null && !Array.isArray(v);
const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

function readPath(root: Doc, path: string): unknown {
  let cur: unknown = root;
  for (const seg of path.split(".")) {
    if (!isPlain(cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** Sets `path` inside `root` (which is already a private copy), creating nothing: the parents must exist. */
function writePath(root: Doc, path: string, value: unknown): void {
  const segs = path.split(".");
  let cur: Doc = root;
  for (const seg of segs.slice(0, -1)) {
    const next = cur[seg];
    if (!isPlain(next)) return;
    cur = next;
  }
  cur[segs[segs.length - 1]] = value;
}

const replaceInArray = (arr: unknown[], uid: string, opaque: string): unknown[] => {
  const out: unknown[] = [];
  for (const item of arr) {
    const next = item === uid ? opaque : item;
    if (next === opaque && out.includes(opaque)) continue;
    out.push(next);
  }
  return out;
};

type Inner = Omit<RewriteSpec, "embedded" | "deleteFields" | "deleteWhen" | "keepNameForIdPrefix">;

/** Applies `spec` to the private copy `work` (a plain map). Returns which pair uid paths matched. */
function applyInner(work: Doc, spec: Inner, uid: string, opaque: string, keepNames: boolean, matched: Set<string>): boolean {
  let changed = false;
  for (const p of spec.pairs ?? []) {
    if (readPath(work, p.uid) !== uid) continue;
    writePath(work, p.uid, opaque);
    matched.add(p.uid);
    changed = true;
    if (p.name && !keepNames && typeof readPath(work, p.name) === "string" && readPath(work, p.name) !== DELETED_ACCOUNT_NAME) writePath(work, p.name, DELETED_ACCOUNT_NAME);
  }
  for (const path of spec.uidArrays ?? []) {
    const arr = readPath(work, path);
    if (!Array.isArray(arr) || !arr.includes(uid)) continue;
    writePath(work, path, replaceInArray(arr, uid, opaque));
    changed = true;
  }
  for (const path of spec.mapKeys ?? []) {
    const map = readPath(work, path);
    if (!isPlain(map) || !(uid in map)) continue;
    const next: Doc = {};
    for (const [k, v] of Object.entries(map)) {
      if (k !== uid) next[k] = v;
    }
    const moved = map[uid];
    const existing = next[opaque];
    next[opaque] = typeof existing === "number" && typeof moved === "number" ? existing + moved : existing !== undefined ? existing : moved;
    writePath(work, path, next);
    changed = true;
  }
  for (const path of spec.mapOfArrays ?? []) {
    const map = readPath(work, path);
    if (!isPlain(map)) continue;
    let touched = false;
    const next: Doc = {};
    for (const [k, v] of Object.entries(map)) {
      if (Array.isArray(v) && v.includes(uid)) {
        next[k] = replaceInArray(v, uid, opaque);
        touched = true;
      } else next[k] = v;
    }
    if (!touched) continue;
    writePath(work, path, next);
    changed = true;
  }
  return changed;
}

export function rewriteDocument(input: { id: string; data: Doc; uid: string; opaque: string; spec: RewriteSpec; knownMatch?: boolean }): RewritePatch | null {
  const { id, data, uid, opaque, spec } = input;
  const keepNames = (spec.keepNameForIdPrefix ?? []).some((prefix) => id.startsWith(prefix));
  const work: Doc = clone(data);
  const matched = new Set<string>();
  let changed = applyInner(work, spec, uid, opaque, keepNames, matched);

  for (const e of spec.embedded ?? []) {
    const target = readPath(work, e.path);
    if (Array.isArray(target)) {
      let touched = false;
      const next = target.map((el) => {
        if (!isPlain(el)) return el;
        const copy = clone(el);
        if (applyInner(copy, e.spec, uid, opaque, keepNames, matched)) {
          touched = true;
          return copy;
        }
        return el;
      });
      if (touched) {
        writePath(work, e.path, next);
        changed = true;
      }
    } else if (isPlain(target)) {
      if (applyInner(target, e.spec, uid, opaque, keepNames, matched)) changed = true;
    }
  }

  const deleteFields: string[] = [];
  const mayDelete = input.knownMatch === true || (spec.deleteWhen !== undefined && matched.has(spec.deleteWhen));
  if (mayDelete) for (const f of spec.deleteFields ?? []) if (f in data) deleteFields.push(f);
  if (!changed && deleteFields.length === 0) return null;

  // Only the top-level keys that actually differ are written (each is a full replacement of that field).
  const set: Doc = {};
  for (const key of Object.keys(work)) {
    if (deleteFields.includes(key)) continue;
    if (JSON.stringify(work[key]) !== JSON.stringify(data[key])) set[key] = work[key];
  }
  if (Object.keys(set).length === 0 && deleteFields.length === 0) return null;
  return { set, deleteFields };
}

/** A row that carries only a name: the name field becomes "Deleted Account". Null when it already is, or the field is not a string. */
export function rewriteNameOnly(data: Doc, nameField: string): RewritePatch | null {
  const v = data[nameField];
  if (typeof v !== "string" || v === DELETED_ACCOUNT_NAME) return null;
  return { set: { [nameField]: DELETED_ACCOUNT_NAME }, deleteFields: [] };
}

export const normalizeName = (name: string): string => name.trim().toLowerCase();
