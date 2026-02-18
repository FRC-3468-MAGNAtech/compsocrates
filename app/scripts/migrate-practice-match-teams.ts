// One-time migration to normalize practiceMatches.allianceTeams as number[]
// Usage:
//   npx tsx app/scripts/migrate-practice-match-teams.ts           (dry run)
//   npx tsx app/scripts/migrate-practice-match-teams.ts --apply   (writes updates)

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "";
const apply = process.argv.includes("--apply");

if (!projectId) {
  console.error("Missing NEXT_PUBLIC_FIREBASE_PROJECT_ID in .env.local");
  process.exit(1);
}

type JsonRecord = Record<string, unknown>;
type FirestoreField = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  nullValue?: null;
  mapValue?: { fields?: Record<string, FirestoreField> };
  arrayValue?: { values?: FirestoreField[] };
};

type FirestoreDoc = {
  name: string;
  fields?: Record<string, FirestoreField>;
};

function decodeField(field: FirestoreField | undefined): unknown {
  if (!field) return undefined;
  if (field.stringValue !== undefined) return field.stringValue;
  if (field.integerValue !== undefined) return Number(field.integerValue);
  if (field.doubleValue !== undefined) return field.doubleValue;
  if (field.booleanValue !== undefined) return field.booleanValue;
  if (field.nullValue !== undefined) return null;
  if (field.mapValue?.fields) {
    const out: JsonRecord = {};
    for (const [key, value] of Object.entries(field.mapValue.fields)) {
      out[key] = decodeField(value);
    }
    return out;
  }
  if (field.arrayValue?.values) return field.arrayValue.values.map((value) => decodeField(value));
  return undefined;
}

function decodeDoc(doc: FirestoreDoc): JsonRecord {
  const out: JsonRecord = {};
  for (const [key, value] of Object.entries(doc.fields || {})) {
    out[key] = decodeField(value);
  }
  return out;
}

function sanitizeTeams(candidate: unknown): number[] {
  const parseArray = (arr: unknown[]): number[] =>
    arr
      .map((item) => {
        if (typeof item === "number") return item;
        if (typeof item === "string") return parseInt(item.replace(/[^\d]/g, ""), 10);
        return NaN;
      })
      .filter((num) => Number.isFinite(num) && num > 0);

  if (Array.isArray(candidate)) return parseArray(candidate);
  if (typeof candidate === "string") {
    const text = candidate.trim();
    if (text.startsWith("[") && text.endsWith("]")) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return parseArray(parsed);
      } catch {
        return parseArray(text.split(","));
      }
    }
    return parseArray(text.split(","));
  }
  return [];
}

function parseAlliances(value: unknown): JsonRecord | undefined {
  if (value && typeof value === "object") return value as JsonRecord;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") return parsed as JsonRecord;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function extractTeams(data: JsonRecord): number[] {
  const alliance = String(data.alliance || "").toLowerCase();
  const alliances = parseAlliances(data.alliances);
  const preferred = alliance === "blue" ? (alliances?.blue as JsonRecord | undefined) : (alliances?.red as JsonRecord | undefined);
  const alternate = alliance === "blue" ? (alliances?.red as JsonRecord | undefined) : (alliances?.blue as JsonRecord | undefined);

  const candidates: unknown[] = [
    data.allianceTeams,
    data.teams,
    data.teamNumbers,
    data.redAllianceTeams,
    data.blueAllianceTeams,
    preferred?.team_keys,
    preferred?.teams,
    alternate?.team_keys,
    alternate?.teams,
  ];

  for (const candidate of candidates) {
    const parsed = sanitizeTeams(candidate);
    if (parsed.length >= 3) return parsed.slice(0, 3);
  }
  return [];
}

function numberFromUnknown(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

async function listPracticeMatchDocs(): Promise<FirestoreDoc[]> {
  const allDocs: FirestoreDoc[] = [];
  let pageToken = "";

  do {
    const query = new URLSearchParams({ pageSize: "500" });
    if (pageToken) query.set("pageToken", pageToken);
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/practiceMatches?${query.toString()}`;
    const response = await fetch(url);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to list practiceMatches: ${response.status} ${body}`);
    }
    const payload = (await response.json()) as { documents?: FirestoreDoc[]; nextPageToken?: string };
    allDocs.push(...(payload.documents || []));
    pageToken = payload.nextPageToken || "";
  } while (pageToken);

  return allDocs;
}

function toIntegerFields(values: number[]): FirestoreField[] {
  return values.map((value) => ({ integerValue: String(Math.trunc(value)) }));
}

async function patchAllianceTeams(docName: string, teams: number[]) {
  const params = new URLSearchParams();
  params.append("updateMask.fieldPaths", "allianceTeams");
  params.append("updateMask.fieldPaths", "migratedAt");
  params.append("updateMask.fieldPaths", "migrationVersion");
  const url = `https://firestore.googleapis.com/v1/${docName}?${params.toString()}`;
  const body = {
    fields: {
      allianceTeams: {
        arrayValue: {
          values: toIntegerFields(teams),
        },
      },
      migratedAt: { integerValue: String(Date.now()) },
      migrationVersion: { stringValue: "practice-team-normalize-v1" },
    },
  };

  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Patch failed for ${docName}: ${response.status} ${text}`);
  }
}

async function patchLegacyScoreFields(docName: string, officialScore: number, penaltyPoints: number) {
  const params = new URLSearchParams();
  params.append("updateMask.fieldPaths", "actualScore");
  params.append("updateMask.fieldPaths", "officialData");
  params.append("updateMask.fieldPaths", "migratedAt");
  params.append("updateMask.fieldPaths", "migrationVersion");
  const url = `https://firestore.googleapis.com/v1/${docName}?${params.toString()}`;
  const body = {
    fields: {
      actualScore: { integerValue: String(Math.trunc(officialScore)) },
      officialData: {
        mapValue: {
          fields: {
            score: { integerValue: String(Math.trunc(officialScore)) },
            penaltyPoints: { integerValue: String(Math.trunc(penaltyPoints)) },
            breakdown: { mapValue: { fields: {} } },
          },
        },
      },
      migratedAt: { integerValue: String(Date.now()) },
      migrationVersion: { stringValue: "practice-team-normalize-v2" },
    },
  };
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Legacy score patch failed for ${docName}: ${response.status} ${text}`);
  }
}

async function run() {
  console.log(`Practice team migration starting (${apply ? "APPLY" : "DRY RUN"})`);
  const docs = await listPracticeMatchDocs();
  console.log(`Found ${docs.length} practiceMatches docs`);

  const decodedDocs = docs.map((doc) => ({ doc, data: decodeDoc(doc) }));
  const groups = new Map<string, Array<{ doc: FirestoreDoc; data: JsonRecord }>>();
  for (const entry of decodedDocs) {
    const matchKey = String(entry.data.matchKey || "");
    const alliance = String(entry.data.alliance || "");
    if (!matchKey || !alliance) continue;
    const groupKey = `${matchKey}::${alliance}`;
    const existing = groups.get(groupKey) || [];
    existing.push(entry);
    groups.set(groupKey, existing);
  }

  let valid = 0;
  let fixable = 0;
  let updated = 0;
  let invalid = 0;

  for (const { doc, data: decoded } of decodedDocs) {
    const existing = sanitizeTeams(decoded.allianceTeams);
    if (existing.length >= 3) {
      valid += 1;
      continue;
    }

    let extracted = extractTeams(decoded);
    if (extracted.length < 3) {
      const groupKey = `${String(decoded.matchKey || "")}::${String(decoded.alliance || "")}`;
      const siblings = groups.get(groupKey) || [];
      const fromSiblings = siblings
        .map(({ data }) => ({
          teamNumber: sanitizeTeams([data.teamNumber])[0] || 0,
          teamPosition: numberFromUnknown(data.teamPosition),
        }))
        .filter((row) => row.teamNumber > 0)
        .sort((a, b) => a.teamPosition - b.teamPosition)
        .map((row) => row.teamNumber);
      if (fromSiblings.length >= 3) extracted = fromSiblings.slice(0, 3);
    }

    if (extracted.length >= 3) {
      fixable += 1;
      console.log(`Fixable: ${doc.name.split("/").pop()} -> [${extracted.join(", ")}]`);
      if (apply) {
        await patchAllianceTeams(doc.name, extracted);
        const officialScore = numberFromUnknown(decoded.officialScore) || numberFromUnknown(decoded.allianceScore);
        const penaltyPoints = numberFromUnknown(decoded.penaltyPoints);
        await patchLegacyScoreFields(doc.name, officialScore, penaltyPoints);
        updated += 1;
      }
    } else {
      invalid += 1;
      console.log(`Still invalid: ${doc.name.split("/").pop()}`);
    }
  }

  console.log("Summary:");
  console.log(`  Already valid: ${valid}`);
  console.log(`  Fixable: ${fixable}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Still invalid: ${invalid}`);

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to write allianceTeams.");
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
