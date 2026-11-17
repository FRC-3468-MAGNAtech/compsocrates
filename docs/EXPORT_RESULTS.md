# Firestore safety copy (read-only export)

`scripts/export-firestore.ts` (`npm run export:firestore`) copies Firestore documents to NDJSON files outside the repository. It only reads. It was tested with a mocked Firestore only; it has never been run against a real project. Code: `lib/firestore-export/`.

**Before any real run:** open the Firebase console, Firestore > Usage, and look at the daily reads. An earlier audit run hit `RESOURCE_EXHAUSTED`, so confirm the quota is not already spent and the live site works. Every document read counts against the 50,000 reads per day (Spark), shared with the site. Set `--daily-ceiling` to 50,000 minus about twice the site's typical daily reads (default 25,000; the ledger counts only this script's reads).

**Personal data and secrets:** the files contain names, emails and scouting history of students, and secret-like fields. By default these fields are replaced by `[REDACTED]` at any depth: `tbaApiKey`, `tbaApiKeyEncrypted`, `encryptedUserData`, `fcmTokens` (`--redact=none` keeps them, `--redact=a,b` replaces the list; `joinCode` is kept). Keep the output off the repository and off OneDrive, Dropbox, iCloud and Google Drive (the script refuses both), store it somewhere access-controlled, and delete it when no longer needed.

## Commands (PowerShell)
Set the credentials in a fresh window only, never in a file. `vite-node` loads `.env*` files for variables not already set, so check that the project id and service-account email the script prints are the ones you mean.
```
$env:CS_ADMIN_PROJECT_ID = "<project id>"
$env:CS_ADMIN_CLIENT_EMAIL = "<service account email>"
$env:CS_ADMIN_PRIVATE_KEY = "<private key, with \n for line breaks>"
npm run export:firestore -- --out=C:\Users\<you>\firestore-exports
npm run export:firestore -- --out=C:\Users\<you>\firestore-exports --run --confirm-project=<project id>
```
The first export command is the dry run (counts only, no documents read; subcollection numbers are an upper bound). Run off-hours. If the estimate is over about 30,000 reads, split it over several days: `--collections=users,teams` one day, others the next (a subcollection such as `teams/settings` needs its parent exported first, in the same folder). At the read cap (`--max-reads`, default 20,000) the run stops cleanly; continue with `--resume` (newest unfinished folder) or `--resume=<folder>`; complete files are skipped, `--force` redoes one. Close the window afterwards.

## Verify
Open `manifest.json` in the timestamped folder: `complete: true`, `mismatches: []`, per-file `documents` equal to `countCheck.counted`, a `sha256` per file, and `redactedFields`. A mismatch can also mean documents changed during the export. Subcollections other than the known ones (`lib/firestore-export/collections.ts`) cannot be listed without reading documents and are not exported.

Restoring is a separate, careful task and has no tool yet. `decodeDocument` in `lib/firestore-export/codec.ts` turns a line back into typed values (round trip tested); redacted fields stay redacted.
