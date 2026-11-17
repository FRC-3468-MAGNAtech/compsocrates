# Session G results: smaller features

Verify: `npm run lint` 0 errors, 1 warning (unused `timeZone` in `match-list-screen.tsx`, not touched). `npm test` 203/204 files, 3013/3014 tests; the one failure is `config/brand-guard.test.ts`, which flags `docs/SESSION_C_RESULTS.md` and `lib/scroll-reset.test.ts` (already failing, not fixed). `npm run test:rules` 299 pass, 21 fail, all in `data/cs/adapter.emulator.test.ts` (the same 21 Session C2 recorded; the profile, changelog and second-program rules tests pass). `npm run build` passed. Nothing deployed, no production writes.

## 1. Admins see every profile on their team
- Before: team admins could already read every same-team profile (rules `isAdmin()`, client `profileAccess`). The real defect was the reverse: an admin's own profile was forced public and their toggle disabled (client `effectiveVisibility`, rules refused an admin saving `private`).
- Now: `profileAccess` (lib/profile/model.ts) = self, platform owner, same-team admin (while the switch is on), else the member's setting. Admins can set their own profile private; that applies to members and other teams, not to admins of their team.
- Owner switch: `appSettings/global.adminsSeeAllProfiles` (missing = on), Admin Panel > Platform owner settings, written by `/api/admin/admins-see-profiles`, read by clients through `/api/public/config`. A one-line note in the profile settings says team admins can always see profiles; it disappears when the switch is off.
- Rules (`firestore.rules`, root and the second program's block, NOT deployed): same-team admin read while the switch is on; platform owner reads any team's profile (your instruction; the old comment said the owner claim opens no team data, so confirm); admins may write their own visibility. **The switch is enforced by the rules** (`get()` on `appSettings/global`), not only by the client.
- Tests: 8 unit tests (member, admin, owner, other-team admin, switch off/missing), 4 new emulator tests (same-team admin yes, member no, other-team admin no, owner yes, switch off/on/missing), e2e spec updated (not run).
- Review follow-up: the Public/Private cards now show a "Selected" badge and a tint; the "Private" card and the limits note say "teammates who aren't admins" only while the switch is on, and just "teammates" when it is off.
- Check before deploying: admins who saved Private earlier (the old code kept it) become private to non-admin teammates.

## 2. Theme scope (all devices / this device only)
- `lib/theme-scope.ts`: one localStorage record per account, `deviceTheme:<uid>` = `{ scope, theme }`, so the scope and the theme are per device and per uid. Order: device theme (scope device) > account > default. The device theme is kept when scope goes back to "all devices"; leaving "device only" with a different theme asks upload or keep (neither deletes it). The account document is never touched in device mode.
- The pre-paint script reads the record of the uid named by the existing owner marker, so no marker (signed out) means nothing device-only applies; sign-out clears the marker, the record stays for the next sign-in. UI: "Theme applies to" in the Appearance panel (Account page).
- Review follow-up: the upload/keep question has a "Don't ask me again" box. The answer is stored on this device in the same per-uid record (`leaveChoice`, additive, device-only), and can be changed or cleared any time under "When I switch back to All my devices" in Appearance (Ask me / Upload / Keep).
- Device theme covers theme, mode and gradient intensity; the glass layer level stays account-wide. 16 new unit tests incl. the script run in a harness.

## 3. App Testing (nothing built)
- Found in the CS reference: no admin-only "App Testing" button exists on Event Select (`event-selection/page.tsx` has none). "App Testing" is (a) a fallback pseudo-event key `app-testing` used when no event date window matches (`eventDetection.ts`, `analyticsEvents.ts`), and (b) the Admin page's "Simulated Date / Time" override (`teams/{id}.timeOverride`, "test event windows when no competitions are live"). The rebuild passes `timeOverride` through but has no UI for it.
- Question for you: is the lost button the Simulated Date/Time tool (an admin setting, not on Event Select), or something from a version not in the reference copy? The second program was not considered.

## 4. Old CS changelog (tooling only, no data)
- The old notes are not in the repo: they live in the old project's Firestore as `{ id, title, body, createdAt, updatedAt }` (free text; no version label, no change markers, no undated entries). So I could not convert real entries; fixtures are synthetic and labelled so.
- Built `lib/changelog/legacy.ts` (wording kept; marker words new/added, fix/fixed, removed, changed/updated/improved map to New/Fixed/Removed/Improved, unmarked lines go to Improved and are flagged; version = a version in the title else the date; date from createdAt in UTC) and `scripts/import-cs-changelog.ts` (dry run by default, input = exported JSON, stable ids `cs-legacy-{team}-{oldId}`, create-only, NOT run).
- Additive `legacy: true`: legacy entries sort below current ones whatever their date, never light the unread dot, and keep the flag through edits. Rules accept the optional key (root only). 13 tests.
- The second program's changelog is a separate follow-up.

## 5. Judge Book card
- "Judging notes" placeholder replaced by a Judge Book card (count, three latest prompts, "Open Judge Book"). Renders nothing without page access to `judge-book` or where the program lists the page as unavailable, and does not mount the data read then. Dead placeholder removed; 2 tests added, registry tests updated.

## Manual browser check
1. Team admin: People > a member with a private profile opens in full.
2. Member: that profile shows the limited card; Account > Privacy shows the "Team admins can always see profiles" line.
3. Owner: Admin Panel, turn the switch off; the admin now gets the limited card and the note is gone (needs the rules deployed to the emulator or project).
4. Account > Appearance: pick "This device only", change theme, reload (it stays); a second browser keeps the account theme.
5. Switch back to "All my devices": the upload/keep question appears.
6. Sign out: default theme; sign in: the right theme returns.
7. Event Select: nothing to check (Task 3).
8. Changelog: nothing to check until the notes are imported.
9. Judge Awards dashboard: click "Open Judge Book".

Next step: answer the App Testing question, export the old team `versionReleases` notes and dry-run the import script, and deploy the rules once the admin-private check above is done.
