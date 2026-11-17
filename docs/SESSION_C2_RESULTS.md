# Session C2 results: BIOBUZZ alliance roles

## What changed
- **Roles:** Hive scout records Tip Hive (auto + teleop). Garden scout records Garden and Flower (you chose Flower with Garden). Config: `allianceRoles` in `config/games/ftc/biobuzz.ts`; only BIOBUZZ has it.
- **Assignment:** `lib/forms/alliance-role.ts`, a seeded bit from event/match/alliance (practice: library match + session id) picks which of the two sorted teams is Hive. Not FRC's red1/blue1 slot rule. No roster or not two teams: no role, all fields shown.
- **Storage:** `values.allianceRole`; the other role's fields are absent. `normalizeValues` keeps absent fields absent; old entries keep both values and still count.
- **Engine:** new `notEquals` visibility op and `FormField.allianceRole`; both added to the form validator.
- **Scout form + practice:** badge "You are scouting: Hive/Garden" (no total). Solo, lobby and live practice pass the role in. Draft restore keeps it.
- **Admin editor:** shows both roles; saving a value for the other role drops the role so a rescore keeps the correction.
- **Analytics:** team stats divide by recorded entries; Team Profile shows an "alliance stat" tag and note, cards and insights add "(alliance)"; Match Breakdown shows Hive/Garden once per alliance; CSV exports empty cells and imports them as absent.
- **Flags:** Zero Main Scoring stands down when an objective was skipped (old all-recorded entries still flag); Statistical Outlier compares same-role entries only. Unrealistic limits, Exceeds Alliance Score, Never Started But Scored, Contradictory Incidents and the 200 cap are unchanged: a skipped objective can only lower a total.
- **Practice:** `rescore-sessions.ts` and accuracy sum entry totals, so each objective counts once. Difficulty cut-offs read in `lib/difficulty.ts` (`thresholds.difficulty`, BIOBUZZ 40/79), unchanged.

## Checks
- `npm run lint`: clean. `npm run build`: passes.
- `npm test`: 2840 pass, 1 fails. New tests: `lib/ftc/alliance-roles.test.ts` (20).
- `npm run test:rules` (Java present): 276 pass, 21 fail (adapter assignments, sub-in and scouting-row tests; Firestore errors in files this session did not touch).

## Unrelated failures (not fixed)
- `config/brand-guard.test.ts` "short name": `docs/SESSION_C_RESULTS.md` (an earlier session's file) names FTC and is not in the guard's allowlist. I added only this session's two docs.
- The 21 `test:rules` failures above (not rerun on the base commit).

## Notes
- Existing BIOBUZZ form overrides saved in Firestore would not carry the role fields until reset to the built-in form.
- Zero Main Scoring no longer flags new BIOBUZZ entries with a total of 0; that case can't be told apart from a robot whose alliance objective went to the other scout.

## Manual browser check
1. Match Scout: pick one qualification match, then each robot of one alliance (two browser profiles): the badges read Hive and Garden.
2. Submit both; open Analytics > Match Breakdown: the alliance shows Hive and Garden once each.
3. Teams > one team: the Hive/Garden rows carry "alliance stat" and the note above.
4. Practice: finish a solo session (two robots); accuracy counts the hive once.
5. Match Scout analytics > export CSV: the unassigned role's cells are empty.
