/**
 * `programs/ftc/scoutEntries` documents as the sister app wrote them, for golden tests.
 *
 * PROVENANCE: these are NOT copies of production documents (nothing here was read from a real project). Each is built to the exact shape the sister app's
 * `saveEntry` / `entryPayloadFor` wrote (its lib/scout-entries.ts): the entry's own fields, `values` keyed by form field, the legacy typed `fields` object
 * written beside `values` for this form, the stored `score`, `teamId` / `uid`, `source` / `mode` / `sessionId` / `libraryMatchId`, a client `submittedAt`, a
 * server `createdAt`, and empty flags. `legacy-v1` has the shape of an entry saved before keyed `values` existed (`fields` + `comments`, no form id).
 * The `score` of each is the arithmetic done by hand from the point table (see the comment on each), and lib/ftc/games.test.ts also checks it against the
 * frozen original scoring, so a slip here fails a test rather than hiding.
 */
import type { FtcScoutEntryDoc } from "@/data/ftc/scouting";

const stamp = (ms: number) => ({ toMillis: () => ms });

const NO_INCIDENTS = { diedDuringMatch: false, neverStartedMatch: false, disabledByFtc: false, recoveredFromFreeze: false, tippedOver: false, yellowCard: false, redCard: false };

const ZEROS = { autoLeave: false, autoPark: false, autoTipHive: 0, teleTipHive: 0, flowerBottomNectar: false, flowerPollenNectar: 0, gardenPollenNectar: 0, endgamePark: false };

/** A v2 entry: `values` and the same data as `fields`, as the sister app wrote both for this form. */
function v2(over: Record<string, unknown>, score: { auto: number; teleop: number; endgame: number; total: number }, extra: FtcScoutEntryDoc = {}): FtcScoutEntryDoc {
  const { comments: note, ...rest } = over;
  const fields = { ...ZEROS, ...NO_INCIDENTS, ...rest };
  const comments = typeof note === "string" ? note : "";
  return {
    teamId: "team-a",
    uid: "uid-scout-1",
    scoutName: "Ada",
    source: "event",
    mode: null,
    sessionId: null,
    libraryMatchId: null,
    formId: "biobuzz",
    formVersion: 1,
    eventCode: "USTXAUS1",
    matchType: "Qualification",
    matchNumber: 7,
    teamNumber: 4242,
    values: { ...fields, comments },
    fields,
    score,
    comments,
    submittedAt: "2026-01-10T15:00:00.000Z",
    createdAt: stamp(1_768_057_200_000),
    excluded: false,
    autoFlags: [],
    manualFlags: [],
    accuracy: null,
    ...extra,
  };
}

/** An entry whose `values` holds only the keys the scout touched, with no legacy `fields` beside it. */
function partialValues(): FtcScoutEntryDoc {
  const doc: FtcScoutEntryDoc = Object.fromEntries(Object.entries(v2({}, { auto: 3, teleop: 0, endgame: 5, total: 8 })).filter(([key]) => key !== "fields"));
  return { ...doc, values: { autoLeave: true, endgamePark: true, comments: "" } };
}

export type BiobuzzDocFixture = { name: string; doc: FtcScoutEntryDoc };

export const BIOBUZZ_ENTRY_DOCS: readonly BiobuzzDocFixture[] = [
  {
    // auto: leave 3 + park 5 + 1 tip x 20 = 28 | teleop: 2 tips x 20 = 40 + bottom nectar 5 + 6 pollen x 2 = 12 + 10 garden x 1 = 10 -> 67 | endgame park 5 | total 100
    name: "strong qualification match",
    doc: v2({ autoLeave: true, autoPark: true, autoTipHive: 1, teleTipHive: 2, flowerBottomNectar: true, flowerPollenNectar: 6, gardenPollenNectar: 10, endgamePark: true, comments: "great cycles" }, { auto: 28, teleop: 67, endgame: 5, total: 100 }),
  },
  {
    // the robot died: it scored nothing
    name: "dead robot",
    doc: v2({ diedDuringMatch: true, tippedOver: true, comments: "died at 0:40" }, { auto: 0, teleop: 0, endgame: 0, total: 0 }, { matchNumber: 12, teamNumber: 9999 }),
  },
  {
    // saved before keyed `values` existed: typed `fields` + `comments`, no form id or version.
    // auto: leave 3 | teleop: 1 tip x 20 = 20 + bottom nectar 5 + 3 pollen x 2 = 6 -> 31 | endgame 0 | total 34
    name: "schema v1 entry (fields only)",
    doc: {
      teamId: "team-a",
      uid: "uid-scout-2",
      scoutName: "Grace",
      source: "event",
      mode: null,
      sessionId: null,
      libraryMatchId: null,
      eventCode: "USTXAUS1",
      matchType: "Qualification",
      matchNumber: 3,
      teamNumber: 1111,
      fields: { ...ZEROS, ...NO_INCIDENTS, autoLeave: true, teleTipHive: 1, flowerBottomNectar: true, flowerPollenNectar: 3, yellowCard: true },
      score: { auto: 3, teleop: 31, endgame: 0, total: 34 },
      comments: "slow but steady",
      submittedAt: "2025-12-05T10:00:00.000Z",
      createdAt: stamp(1_764_928_800_000),
      excluded: false,
      autoFlags: [],
      manualFlags: [],
      accuracy: null,
    },
  },
  {
    // a practice session entry against a library match: auto 2 tips = 40 | teleop 3 tips = 60 + 25 garden = 25 -> 85 | endgame park 5 | total 130
    name: "practice trial entry",
    doc: v2(
      { autoTipHive: 2, teleTipHive: 3, gardenPollenNectar: 25, endgamePark: true },
      { auto: 40, teleop: 85, endgame: 5, total: 130 },
      { source: "practice", mode: "trial", sessionId: "session-1", libraryMatchId: "USTXAUS1_Q4", matchType: "Practice", matchNumber: 4, accuracy: { status: "complete", value: 0.91, scoutedTotal: 130, penaltyPoints: 4, officialScore: 140 } }
    ),
  },
  {
    // every counter above its "unrealistic" limit: auto 4 tips = 80 | teleop 7 tips = 140 + 21 pollen x 2 = 42 + 41 garden = 41 -> 223 | endgame 0 | total 303
    name: "counters above the unrealistic limits",
    doc: v2(
      { autoTipHive: 4, teleTipHive: 7, flowerPollenNectar: 21, gardenPollenNectar: 41 },
      { auto: 80, teleop: 223, endgame: 0, total: 303 },
      { autoFlags: [{ ruleId: "unrealistic-scoring", dismissed: false }], manualFlags: [{ id: "m1", reason: "Unrealistic scoring", addedAt: "2026-01-10T16:00:00.000Z" }] }
    ),
  },
  {
    // `values` with only the keys the scout touched: the rest read as off or zero. auto: leave 3 | endgame park 5 | total 8
    name: "partial values",
    doc: partialValues(),
  },
  {
    // a live-scouted playoff match: auto park 5 | teleop bottom nectar 5 + 10 pollen x 2 = 20 -> 25 | endgame park 5 | total 35
    name: "live playoff entry",
    doc: v2({ autoPark: true, flowerBottomNectar: true, flowerPollenNectar: 10, endgamePark: true, comments: "clean" }, { auto: 5, teleop: 25, endgame: 5, total: 35 }, { source: "live", mode: null, sessionId: "session-2", matchType: "Playoff", matchNumber: 2 }),
  },
];
