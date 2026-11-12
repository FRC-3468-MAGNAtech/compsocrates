# Firebase read findings: scout accuracy and practice sessions

Static comparison of old CS (`app/scout-accuracy`, `app/practice-scouting`, `app/profile`) with the rebuild (`lib/practice-queries.ts`,
`lib/practice-sessions.ts`, `data/cs/practice.ts`, `lib/scout-stats/*`). No production data was read, so nothing below is checked
against real documents. The event-scoping theory is **not supported**: scout stats and practice sessions are read team-wide,
not per event.

## Old CS vs rebuild: the reads that differ
| Data | Old CS | Rebuild |
|---|---|---|
| Practice sessions (accuracy) | `practiceSessions where mode == X`, no team filter. Keeps a doc if `teamId` is empty or equals ours | `practiceSessions where teamId == ours` |
| Practice sessions (per scout) | `where scoutId == uid` and `where scoutName == name`, no team filter | `where teamId == ours and scoutId == uid` |
| Session owner | `scoutId`, else lower-cased `scoutName` | `uid = scoutId` only |
| Game | `game` (missing = REEFSCAPE) must equal the selected game | no game filter in scout stats |
| Live sessions | skipped (`isLivePracticeScouting`) | mapped as `solo`, counted |
| Exclusions | `excludeFromAccuracy` field, or `scoutingFlagStates` `practiceSession:<id>` | `excluded: false` always |
| No accuracy number | skipped (`Number.isFinite`) | counted as 0 (`accuracy ?? 0`) |
| Match entries | whole `scouting` collection, bucketed by scoutId/scoutName | `teamId ==` plus a fallback by member uid/name (narrower on purpose: the old read crossed teams) |

## Ranked root causes
1. **Sessions with no `teamId` are never fetched or mapped.** CS writes `teamId: userData.teamId || ""`, so a session saved
   by a scout who had no team at the time has an empty one. Old CS still counted it; the rebuild's query
   (`lib/practice-queries.ts:31,50`) can't match it and `data/cs/practice.ts:233` would drop it anyway. Impact: practice
   history and the practice half of scout accuracy are missing for those scouts.
2. **Sessions are attributed by `scoutId` only.** Old CS fell back to `scoutName`. `data/cs/practice.ts:191` sets `uid` to
   `scoutId` (empty when only a name was stored), and `lib/scout-stats/engine.ts:81,106` matches `s.uid === member.uid`, so
   those sessions belong to nobody. Impact: blank accuracy for those scouts.
3. **No game filter, live sessions counted** (`engine.ts`, `data/cs/practice.ts:193`). Old CS averaged one game at a time and
   skipped live sessions. Impact: averages mix REBUILT, REEFSCAPE and CHARGED UP; wrong numbers rather than blank ones.
4. **Exclusions ignored** (`data/cs/practice.ts:210`). Sessions old CS excluded from accuracy are included.
5. **Null accuracy counts as 0** (`engine.ts:83,108`). Drags averages down; old CS skipped them.
6. **Unverified, could explain "doesn't display at all":** the Scout Accuracy page waits for five sources (members, sessions,
   entries, library matches, attendance). If one errors, `loaded` may never flip. Session errors are logged
   (`[firestore] team practiceSessions subscription failed`) and exposed as `error`, but I did not check every source or
   whether the page renders `error`. The browser console will show which one fails.

## Checked and fine
- Collection names, field names and event-key aliasing match for these reads. No FTC/CE leftovers in these queries.
- No `limit()` anywhere in these paths. All queries are equality-only, so no composite index is needed; the CS reference has no
  rules or index files to compare, and the supplied production rules allow these reads for any signed-in user.
- No query fires before auth: each hook waits for `teamId`.

## Fix applied (causes 1 to 5; cause 6 stays unverified)
- `lib/practice-extras.ts` (shared fetch) with pure helpers in `data/cs/practice.ts`: sessions read as `teamId == ours` merged with sessions of team members matched by
  `scoutId` or `scoutName`, de-duplicated; a session with no `teamId` belongs to the team when its scout is a member.
- Map `uid` from `scoutId`, else the member whose name matches; keep `isLive`, `game`, and the exclusion flags (field plus
  flag states) on the session; stats skip live, other-game, excluded and accuracy-less sessions.
- Fetch once in a shared provider; show the Firestore error state on both pages instead of an empty list.
- Not needed: any rules or index change.
