import { GeoPoint, Timestamp } from "firebase-admin/firestore";

// Typed JSON for Firestore values, so an export can be restored later without losing a type. A plain JSON dump would turn a Timestamp into
// a map and a DocumentReference into an object, and NaN / Infinity into null. Tagged values are `{ "__fs": "<type>", ... }`; a map the
// user stored that happens to contain the key `__fs` is wrapped as `{ "__fs": "map", "value": { ... } }` so it can never be mistaken for a tag.

export const TAG = "__fs";

type Ref = { path: string; id: string; collection: unknown };

function isRef(v: unknown): v is Ref {
  const r = v as Partial<Ref>;
  return typeof r.path === "string" && typeof r.id === "string" && typeof r.collection === "function";
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function encodeEntries(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = encodeValue(v);
  return out;
}

export function encodeValue(v: unknown): unknown {
  if (v === null || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") {
    if (Number.isFinite(v) && !Object.is(v, -0)) return v;
    return { [TAG]: "number", value: Object.is(v, -0) ? "-0" : String(v) };
  }
  if (typeof v === "bigint") return { [TAG]: "bigint", value: v.toString() };
  if (v === undefined || typeof v === "function" || typeof v === "symbol") throw new Error(`Cannot encode a value of type ${typeof v}`);
  if (v instanceof Timestamp) return { [TAG]: "timestamp", seconds: v.seconds, nanoseconds: v.nanoseconds };
  if (v instanceof Date) {
    const t = Timestamp.fromDate(v);
    return { [TAG]: "timestamp", seconds: t.seconds, nanoseconds: t.nanoseconds };
  }
  if (v instanceof GeoPoint) return { [TAG]: "geopoint", latitude: v.latitude, longitude: v.longitude };
  if (v instanceof Uint8Array) return { [TAG]: "bytes", base64: Buffer.from(v).toString("base64") };
  if (Array.isArray(v)) return v.map(encodeValue);
  const obj = v as Record<string, unknown>;
  if (isRef(obj)) return { [TAG]: "reference", path: obj.path };
  if (typeof obj.toArray === "function" && (obj.constructor as { name?: string } | undefined)?.name === "VectorValue") {
    return { [TAG]: "vector", values: (obj.toArray as () => number[])().map((n) => encodeValue(n)) };
  }
  if (!isPlainObject(obj)) throw new Error(`Cannot encode an object of class ${((obj as object).constructor as { name?: string } | undefined)?.name ?? "unknown"}`);
  if (Object.prototype.hasOwnProperty.call(obj, TAG)) return { [TAG]: "map", value: encodeEntries(obj) };
  return encodeEntries(obj);
}

/** Builds a reference for a path. A restore passes `(p) => firestore.doc(p)`; a test passes a stand-in. */
export type RefFactory = (path: string) => unknown;

function decodeEntries(obj: Record<string, unknown>, makeRef: RefFactory): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = decodeValue(v, makeRef);
  return out;
}

export function decodeValue(v: unknown, makeRef: RefFactory): unknown {
  if (Array.isArray(v)) return v.map((x) => decodeValue(x, makeRef));
  if (v === null || typeof v !== "object") return v;
  const obj = v as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(obj, TAG)) return decodeEntries(obj, makeRef);
  switch (obj[TAG]) {
    case "map":
      return decodeEntries(obj.value as Record<string, unknown>, makeRef);
    case "number":
      return obj.value === "-0" ? -0 : Number(obj.value);
    case "bigint":
      return BigInt(obj.value as string);
    case "timestamp":
      return new Timestamp(obj.seconds as number, obj.nanoseconds as number);
    case "geopoint":
      return new GeoPoint(obj.latitude as number, obj.longitude as number);
    case "bytes":
      return Buffer.from(obj.base64 as string, "base64");
    case "reference":
      return makeRef(obj.path as string);
    case "vector":
      return (obj.values as unknown[]).map((x) => decodeValue(x, makeRef));
    default:
      throw new Error(`Unknown encoded type "${String(obj[TAG])}"`);
  }
}

/** One NDJSON line for a document. */
export function encodeDocument(path: string, data: Record<string, unknown>): string {
  return `${JSON.stringify({ path, data: encodeEntries(data) })}\n`;
}

export function decodeDocument(line: string, makeRef: RefFactory): { path: string; data: Record<string, unknown> } {
  const parsed = JSON.parse(line) as { path: string; data: Record<string, unknown> };
  return { path: parsed.path, data: decodeEntries(parsed.data, makeRef) };
}
