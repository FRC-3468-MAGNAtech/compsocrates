# BIOBUZZ alliance roles: plan (Phase 1)

## 1. Fields
- Hive (Tip Hive, 20 pts, counters): `autoTipHive` (auto, cat Hive), `teleTipHive` (teleop, group `hive`). Config `config/games/ftc/biobuzz.ts:65,68`.
- Garden: only `gardenPollenNectar` (1 pt per tally, teleop, group `garden`, unrealistic above 40). No auto Garden field exists.
- Other alliance-level candidate: the **Flower** group (`flowerBottomNectar` toggle 5 pts, `flowerPollenNectar` counter 2 pts, teleop) looks alliance-scored too. Not in your rule, so left per-robot. Please confirm.
- `tippedOver` is a separate reliability incident; untouched.

## 2. How FRC chooses the human player (do not copy)
- `data/cs/assignments.ts:289`: `isHumanPlayerSlot` is true for `red1` and `blue1` only. Stored as `scoutHumanPlayer` on the assignment row when an admin creates it.
- Not random, not client-side. Both scouts agree because it is fixed by slot. Nothing in the scout form reads `scoutHumanPlayer`.
- Copying it would give Hive to robot 1 every match, so Hive stats would exist only for teams the schedule puts in slot 1. Rejected.
- **Recommendation: deterministic seeded choice, computed client-side from shared data, nothing stored in advance.** Seed = `eventKey|matchType|matchNumber|alliance` (practice: library match id + session id instead of event). Reuse `mulberry32` (`lib/scheduler/rng.ts`). One bit picks which of the alliance's two teams, sorted ascending, is Hive; the other is Garden. Both scouts and both robots of a practice session get the same answer, opposite roles. Stored on the entry as `allianceRole`.
- Fallback: roster not loaded or alliance has fewer than 2 known teams: no role, all fields shown (old behaviour).

## 3. Where the fields are read
- Form: `lib/forms/game-form.ts` (generated from config; has `visibleWhen`, which also hides fields in `validateValues`, `scout-form.tsx:436`, `form-renderer.tsx:70`).
- Scoring: `lib/games/point-table.ts` (`scoreDoc` reads absent as 0, `buildDoc` skips undefined: already safe). Custom scoring (`lib/forms/scoring.ts:43`) ignores `visibleWhen`, so hidden values must be stripped before saving.
- Practice: `rescore-sessions.ts` -> `calculateScore` -> `resolveLobbyPairScoring` sums entry totals vs official: safe once absent = 0 (old double-recorded sessions stay as they were).
- Analytics: `team-stats.ts` (`numberValue` returns 0 for absent, divides by all entries; `elementBreakdown`), `match-breakdown.ts` (`scoutedTotal` sums entry totals: counts each objective once), `flags.ts`, `game-schema.ts` (column values), `csv.ts` (`formatCellForCsv` already writes null/undefined as empty; import goes through `normalizeValues`).
- Admin editor `components/admin/entry-edit-dialog.tsx:81` filters by `visibleFieldKeys`. Draft restore `lib/forms/draft.ts` stores `values`, so a role key in values persists.
- Difficulty cut-offs: `lib/difficulty.ts` `difficultyThresholdsFor` reads `thresholds.difficulty` (BIOBUZZ 40/79). Used by practice match-select and the library panels. Unchanged.

## 4. Design and conflicts
- Config: a generic optional `allianceRoles` block on the BIOBUZZ definition (role id, label, field keys). `game-form.ts` adds a `allianceRole` value plus `visibleWhen` per role field. FRC/other games have no block, so no change.
- Scout form: computes the role from match + team (+ session), shows "You are scouting: Hive/Garden" (text only, no score). Admin editor ignores role visibility and shows both.
- Conflicts found:
  1. `defaultValues` (`plugin.defaultValues`, `lib/forms/values.ts`) and `normalizeValues` fill counters with 0, so absent turns into 0 on a new form, on CSV import and in `hasProgress`. Needs a role-aware "leave absent".
  2. Custom scoring and `buildDoc` ignore visibility (see 3).
  3. `team-stats` treats absent as 0 and divides by all entries. Will use recorded entries only for role fields, and add alliance-stat labels in Team Profile and team cards.
- Flags: Zero Main Scoring: skip when a role field is absent (the missing objective could have been the only score). Statistical Outlier: compare only against same-role entries (Hive 20-pt tips vs 1-pt Garden shifts totals). Exceeds Alliance Score, 200 cap, Never Started But Scored, Contradictory Incidents: fewer points can only lower totals, so no change. Unrealistic thresholds untouched.
- Match breakdown: add alliance-level Hive and Garden rows (sum of both robots, each once).
- Legacy entries (both values, no `allianceRole`) keep both and count as recorded.
- Tests, CLAUDE.md note and results doc follow in Phase 2.
