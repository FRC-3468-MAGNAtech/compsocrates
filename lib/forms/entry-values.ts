import type { Form, FormValues } from "@/lib/forms/types";
import { applyAliases } from "@/lib/forms/values";

// An entry's values, read the one way every consumer reads them. An entry carries `values` keyed by its form's field `key` (the adapter in data/cs/ builds
// them from the CS document), so this is the single place that applies the form's `keyAliases` (a value stored under a since-renamed key reads under its
// current key) and drops anything that is not a plain value.

/** The parts of an entry the reader needs (a stored ScoutEntry satisfies it, as does a fixture). */
export type EntryValueSource = { values?: Record<string, unknown> | null };

type Cached = { aliasKey: string; values: FormValues };
const cache = new WeakMap<object, Cached>();

function coerce(raw: Record<string, unknown>): FormValues {
  const out: FormValues = {};
  // a value can also be a list (a sequence, photos) or a map of cells (a matrix); anything else (null, undefined, functions) is dropped
  for (const [k, v] of Object.entries(raw)) if (typeof v === "boolean" || typeof v === "number" || typeof v === "string" || (v !== null && typeof v === "object")) out[k] = v as FormValues[string];
  return out;
}

/** An entry's values as `{ key: value }`, with `keyAliases` applied. Cached per entry object (cheap to call per table cell). */
export function entryValues(entry: EntryValueSource, form?: Pick<Form, "keyAliases"> | null): FormValues {
  const aliases = form?.keyAliases;
  const aliasKey = aliases ? JSON.stringify(aliases) : "";
  const hit = cache.get(entry);
  if (hit && hit.aliasKey === aliasKey) return hit.values;

  const values = coerce(applyAliases(entry.values && typeof entry.values === "object" ? entry.values : {}, aliases));
  cache.set(entry, { aliasKey, values });
  return values;
}
