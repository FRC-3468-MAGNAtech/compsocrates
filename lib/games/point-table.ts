/**
 * The generic point-table plugin: builds a `GamePlugin` from a `PointTableGameDefinition` (`config/games/*`), so a game whose scoring is
 * "points per tally, per toggle and per chosen option" is pure config (REEFSCAPE, CHARGED UP). Scores are identical to CS's own functions
 * (`analyticsScoring.ts`, `scoutingFlags.ts`): the golden tests in `lib/games/point-table.test.ts` run every definition against `cs-oracle/`.
 *
 * Form value keys follow the KEY CONVENTION in `lib/games/types.ts`; each field names its key and its CS doc path, so `docToValues` and
 * `valuesToDoc` are exact inverses over the fields the definition lists. Anything else on a CS doc is the adapter's job to preserve (D10).
 */
import type { GameField, GameFieldPoints, PointTableGameDefinition } from "@/config/games/definition";
import { DEFAULT_VERIFICATION_METRICS, VERIFICATION_THRESHOLD } from "@/config/games/shared";
import { buildTacticalPrediction, compareScoutToLead, computeRescoutDiff, finiteNum, normalizeGameName, num, readPath } from "@/lib/games/common";
import type { CsDoc, FullGamePlugin, GameId, GameValues, PhaseScore, ScoutingFlag } from "@/lib/games/types";

/** The value of a field on a CS doc: the first of its paths (`path`, then `mirrors`) that holds a value, as CS's `auto.mobility ?? mobility` does. */
export function readField(doc: CsDoc, field: Pick<GameField, "path" | "mirrors">): unknown {
  for (const path of [field.path, ...(field.mirrors ?? [])]) {
    const value = readPath(doc, path);
    if (value !== undefined && value !== null) return value;
  }
  return readPath(doc, field.path);
}

/** Sets a dotted path on a doc, creating the nested objects (`auto.gridBottom`). */
function setPath(target: CsDoc, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor: Record<string, unknown> = target;
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part];
    if (next === null || typeof next !== "object" || Array.isArray(next)) cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
}

/** Points a field's value is worth under its scoring rule (the same arithmetic CS uses: `Number(v || 0) * n`, truthiness, trimmed or `includes` text match). */
export function pointsFor(points: GameFieldPoints | undefined, raw: unknown): number {
  if (!points) return 0;
  switch (points.mode) {
    case "perTally":
      return num(raw) * points.value;
    case "whenOn":
      return raw ? points.value : 0;
    case "optionExact": {
      const key = String(raw || "").trim().toLowerCase();
      return Object.prototype.hasOwnProperty.call(points.points, key) ? points.points[key] : 0;
    }
    case "optionIncludes": {
      const text = String(raw || "").toLowerCase();
      const rule = points.rules.find((r) => r.includes.some((part) => text.includes(part)));
      return rule ? rule.points : 0;
    }
  }
}

const strList = (value: unknown): string[] => (Array.isArray(value) ? value.map((v) => String(v)) : []);

function coerce(kind: GameField["kind"], value: unknown): unknown {
  switch (kind) {
    case "counter":
    case "number": {
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    }
    case "toggle":
      return Boolean(value);
    default:
      return String(value ?? "");
  }
}

const fill = (template: string, figures: Record<string, number>): string => template.replace(/\{(\w+)\}/g, (_, key: string) => String(figures[key] ?? ""));

/** The default form value of a field: 0 for a tally or number, off for a toggle, empty text for the rest. */
const defaultFor = (kind: GameField["kind"]): unknown => (kind === "counter" || kind === "number" ? 0 : kind === "toggle" ? false : "");

export function createPointTablePlugin<Id extends string = GameId>(def: PointTableGameDefinition<Id>): FullGamePlugin<Id> {
  const phaseOf = new Map(def.sections.map((s) => [s.id, s.phase]));
  const scored = def.fields.filter((f) => f.points !== undefined);

  function scoreDoc(doc: CsDoc): PhaseScore {
    const phases = { auto: 0, teleop: 0, endgame: 0 };
    for (const field of scored) {
      const phase = phaseOf.get(field.section);
      if (phase === "auto" || phase === "teleop" || phase === "endgame") phases[phase] += pointsFor(field.points, readField(doc, field));
    }
    const penalty = def.penaltyPath ? num(readPath(doc, def.penaltyPath)) : 0;
    const total = phases.auto + phases.teleop + phases.endgame + penalty;
    return def.penaltyPath ? { ...phases, total, penalty } : { ...phases, total };
  }

  function flags(doc: CsDoc): ScoutingFlag[] {
    const rules = def.flags;
    if (!rules) return [];
    // CS (scoutingFlags.ts) reads each count as `toNumber`: non-finite counts as 0.
    const group = (name: NonNullable<GameField["flagGroup"]>): number =>
      def.fields.filter((f) => f.flagGroup === name && f.points?.mode === "perTally").reduce((sum, f) => sum + finiteNum(readField(doc, f)) * (f.points as { value: number }).value, 0);
    const auto = group("autoRobot");
    const teleRobot = group("teleopRobot");
    const teleHuman = group("teleopHuman");
    const out: ScoutingFlag[] = [];
    const hp = rules.humanPlayerHeavy;
    const ao = rules.autoOnlyNoTeleop;
    if (teleHuman >= hp.minHumanPoints && (teleRobot <= 0 || teleHuman >= teleRobot * hp.shareOfRobotPoints)) {
      out.push({ code: "human-player-heavy", label: hp.label, detail: fill(hp.detail, { human: teleHuman }) });
    }
    if (auto >= ao.minAutoPoints && teleRobot <= 0 && teleHuman <= 0) {
      out.push({ code: "auto-only-no-teleop", label: ao.label, detail: fill(ao.detail, { auto }) });
    }
    if (auto <= 0 && teleRobot <= 0 && teleHuman <= 0) {
      out.push({ code: "zero-main-scoring", label: rules.zeroMainScoring.label, detail: rules.zeroMainScoring.detail });
    }
    return out;
  }

  function docToValues(doc: CsDoc): GameValues {
    const values: GameValues = {};
    for (const field of def.fields) {
      const value = readField(doc, field);
      if (value !== undefined) values[field.key] = value;
    }
    if (doc.incidents !== undefined) values.incidents = doc.incidents;
    return values;
  }

  function buildDoc(values: GameValues): CsDoc {
    const doc: CsDoc = { game: def.id };
    for (const field of def.fields) {
      const value = values[field.key];
      if (value === undefined) continue;
      const stored = coerce(field.kind, value);
      for (const path of [field.path, ...(field.mirrors ?? [])]) setPath(doc, path, stored);
    }
    if (values.incidents !== undefined) doc.incidents = strList(values.incidents);
    return doc;
  }

  const valuesToDoc = (values: GameValues): CsDoc | null => (def.submittable ? buildDoc(values) : null);

  return {
    id: def.id,
    label: def.label,
    season: def.year,
    formId: def.formId,
    submittable: def.submittable,
    // CS quirk: a doc without a `game` field belongs to the definition that says so (REEFSCAPE).
    matches: (doc) => {
      const game = normalizeGameName(doc.game);
      return game === def.id || (def.docsWithoutGame === true && game === "");
    },
    docToValues,
    valuesToDoc,
    scoreDoc,
    scoreValues: (values) => scoreDoc(buildDoc(values)),
    defaultValues: () => ({ ...Object.fromEntries(def.fields.map((f) => [f.key, defaultFor(f.kind)])), incidents: [] }),
    flags,
    verify: (junior, lead, options) => compareScoutToLead(junior, lead, options?.metrics ?? DEFAULT_VERIFICATION_METRICS, options?.threshold ?? VERIFICATION_THRESHOLD),
    predict: (team, docs, source, tier) => buildTacticalPrediction(team, docs, source, tier, (doc) => scoreDoc(doc).total),
    compareToExemplar: (original, exemplar) => computeRescoutDiff(original, exemplar, def.rescoutFields),
  };
}
