# Session I: CompSocrates v2 beta release prep

Branch `release-prep`, from `rebuild`. Nothing merged, nothing deployed, nothing pushed to `main`, no console or production service touched. Live branch = `main` (head 98071e9 at the start; old tip tagged `live-before-v2` and pushed).

## Git
- Docs reformat committed on `rebuild` first (c23691d, docs only). Then `release-prep` from it and `git merge -s ours --allow-unrelated-histories origin/main` (13fab8b). Checked at once: `git diff --stat rebuild release-prep` empty, `origin/main` IS an ancestor of `release-prep`, and `release-prep` adds 268 commits over `origin/main`. No rebase, squash or force-push.
- Conflicts: none (the `ours` strategy keeps the v2 tree; the 680 live commits are history only). Hotfixes: every `main` commit is also in `preview`, which the CS reference folder was copied from (preview is 30 ahead, 0 behind), so nothing on `main` postdates what v2 was built from; the newest are the pick-list commits (98071e9, bf9bbd2), which v2 covers (team-wide pick list, lead roles may edit).
- Local `main` held 7 commits not in `rebuild`, so it was renamed `main-rebuild-archive` (local only; it and `backup-before-filter` hold `docs/SECURITY-NOTES.md` in history: never push them).
- Rollback: Vercel "promote previous deployment", then on `main` `git revert -m 1 <merge commit>`; see `docs/GO_LIVE_CHECKLIST.md`.

## Privacy (the repo must be PRIVATE; the owner is confirming)
- Tracked: `docs/cs-firestore.rules` (yes), `CS-OPEN` comments in `firestore.rules` (yes, 4), scripts naming credential variables (4: audit-event-attendance, export-cs-changelog, import-cs-changelog, migrate-ce-to-ftc; names only, no values). `docs/SECURITY-NOTES.md` is NOT tracked (ignored) and not in `rebuild` history.
- Secret scan of the tree: no private-key blocks, no service-account or exported JSON, no `.env*` except `.env.example`; two test files hold fake Blob-token-shaped placeholders (lib/blob/stores.test.ts:9-10). `.gitignore` covers `.env*`, `*adminsdk*.json`, `*service-account*.json`, `*serviceAccount*.json`, `ce-users.json`, SECURITY-NOTES.

## Defaults and the FTC gate (commits d8ded23, 491febd)
- `avatarUploadsEnabled` missing = OFF (uploads only when explicitly true): server, public config, Admin switch, client, tests. `adminsSeeAllProfiles` missing = ON (kept). `teamCreationEnabled` missing = OFF and `/api/public/config` no longer writes anything. `formSubmissionSettings` missing = every form open (already tested). Tests: `lib/server/team-settings.test.ts`, `lib/avatar/settings.test.ts`, the emulator public-config tests.
- FTC Create tab: one shared card state (`creationMode`, `TEAM_CREATION_CLOSED_TEXT`), no program-id comparison. Off shows "Applications to create a team aren't open yet..." (FTC has no application flow); FRC keeps its "Apply to create a team" route.
- FTC rule `ftc_teamCreationOpen()`: team create and the profile create in the same batch need `appSettings/global.teamCreationEnabled == true`. Join requests, approval and the root rules are untouched. Emulator tests: document missing, field missing, false, true, odd values, no profile, existing members, join path, approval.
- **State plainly:** FRC team creation and FRC self-writes to `users.teamId` stay OPEN at the rules level (inherited CS-OPEN, unchanged, because the old app may still be live while the rules deploy first). Closing sign-up for FRC is the setup screen and `/api/team/create` only. Tightening them is the first post-release rules task. The owner sets `teamCreationEnabled: false` and `avatarUploadsEnabled: false` by hand in `appSettings/global`.

## Checks (on `release-prep`)
- `npm run lint`: 0 errors, 0 warnings (the known jsx-ast-utils notice).
- `npm test`: 4121 of 4124 pass (325 files). The 3 failures are `config/brand-guard.test.ts`, present before this session (files not touched here); left alone.
- `npm run test:rules` (Java 21 + emulator): 434 of 434 pass, 7 files.
- `npm run build`: passes (theme guard 434 checks, 49 static pages). One type error in a new test was fixed first.
- Playwright (browsers installed; Firebase pointed at the emulator host, no real project): a first full run (884 tests, 4 browser projects, dev server) was stopped after about an hour as too slow. A second run, `chromium-desktop` only on a production build: 190 passed, 9 failed, about 10 phone-only tests skipped. Failures (not investigated, none touch files changed here, not fixed): form-analytics 2, form-builder live preview, match-list scroll/status, page-access matrix and no-access request, profiles 2, team-forms pit form. Webkit and phone projects not run. REMAINING.md already warns the fixtures were rewritten without a run.
- Never run: Lighthouse, the mobile audit script, a browser pass of the pages.

## Audit (`npm audit --omit=dev`: 1 critical, 10 high, 6 moderate, 1 low). Nothing upgraded.
- next (critical; 16.0.0 to 16.4.4): REACHABLE for Image Optimization (`next/image` is used) and Server Actions (`lib/events/actions.ts`); `next/og` and `use cache` are not used. Non-breaking fix: next@16.4.6 (exact-pinned today).
- sharp (high, <0.35.5, librsvg): reachable only through avatar upload, which accepts JPEG, PNG and WebP by magic bytes (SVG refused) and is off. Fix: sharp@0.35.5.
- zod (high, <4.6.6): zod 3 is used for form validation; the flagged copy is zod 4 inside `@vercel/cli-config`, not reachable from app code. Fix needs a major bump.
- `@vercel/blob`, `@vercel/oidc`, `@vercel/cli-config` (high, one chain, the zod above): the SDK is used server-side for uploads, the flagged code is not on that path. Fix needs `@vercel/blob@2.4.0` (a downgrade).
- `firebase`, `@firebase/firestore`, `@firebase/firestore-compat`, `@grpc/grpc-js` (high): the advisories are about gRPC servers and mTLS auth contexts; the web client does not run those. The tool offers only `firebase@9.14.0` (a major downgrade): do NOT apply it.
- `source-map-js` (high): build-time only (PostCSS). Non-breaking fix available.

## Docs
- `docs/REMAINING.md`: the stale "Not connected" list now matches `connection.paths`; defaults and Session I noted. `docs/DEPLOYMENT.md`: defaults, no index deploy. New: `docs/GO_LIVE_CHECKLIST.md`, `docs/SMOKE_TEST.md`.

## Branches left behind (not merged, deleted or modified)
- `origin/CompSocrates-v2`: 35 commits not in main (Oct 2026): a "Greek-Tech" floating-HUD v2 interface rebuild and retheme (red/white/gold, glass design), plus the 30 `preview` commits below. Anything unique there is UI experiments.
- `origin/preview`: 30 commits not in main (Aug 2026): Charged Up analytics and missed-grid tracking, trial/competitive scout accuracy rework, robot radar and performance-reliability fixes, climb reliability box plot, pick list stored on the team doc, "Expand team admin and scouting analytics", submission-lockout banner, Match Prediction tab, Team Communication hub (ec642be). v2 re-implements most of these areas; confirm the Team Communication hub and Match Prediction behave as you expect before the old branches are archived.

## Blockers / go or no-go
- NO-GO until the owner has done: private-repo check, Firestore backup, saved and compared live rules, full rules deployed, `appSettings/global` flags, `FIREBASE_ADMIN_*` set and the exposed key rotated, a separate Production Blob store, a preview smoke test. Nothing in the code blocks the release.
