# Environment and outside services

Everything the app reads from the environment, and every outside host its code calls. `.env.example` is the template (placeholders only). The names there are checked against `ENV_VARS` in `lib/server/env.ts` by a unit test, so the list below, the template and the code cannot drift apart silently. A signed-in admin can see what is missing right now under **Admin Panel > Setup Check** (names only, never values).

The event-data and sign-in code (`lib/frc`, `lib/firebase/admin.ts`, `lib/server/require-user.ts`, the live and cron routes) reads its keys only through `lib/server/env.ts`. Besides the variables below, the code uses a few switches that are not settings: the emulator hosts and `NEXT_PUBLIC_USE_FIREBASE_EMULATOR` (local development and tests), `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` (optional analytics id), the host-provided `VERCEL_URL` and `VERCEL_PROJECT_PRODUCTION_URL` (email links), and `E2E_THEME_CHECK` (Playwright).

## Variables

Group A uses the same names as the CompSocrates app. Group B is required by this rebuild's server routes. Group C switches an optional feature on.

### A. CompSocrates (same names as the CompSocrates app)

| Variable | What it is | What breaks while it is unset |
|---|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase web config | Sign-in and all data (the app cannot reach Firebase) |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase web config | Sign-in |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase web config | All data |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Firebase web config | File storage references |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase web config | Push notifications |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase web config | Sign-in |
| `NEXT_PUBLIC_TBA_API_KEY` | The Blue Alliance read key. **Read on the server only**: no client code references it, so it is never inlined into a browser bundle. | Event names, schedules, teams, rankings and playoff brackets |
| `FIRST_API_USERNAME` | FIRST FRC Events API username | Practice schedules and the FIRST fallback for teams and rankings |
| `FIRST_API_TOKEN` | FIRST FRC Events API token | Same as `FIRST_API_USERNAME` |
| `RELEASE_OWNER_UIDS` | Comma-separated uids of the platform owner(s) | Nobody is recognised as platform owner by uid |
| `RELEASE_OWNER_EMAILS` | Comma-separated emails of the platform owner(s) | Owner-by-email recognition. One of the two owner variables is enough. |

### B. Required by the rebuild's server routes

| Variable | What it is | What breaks while it is unset |
|---|---|---|
| `FIREBASE_ADMIN_PROJECT_ID` | Firebase Admin service account | Server sign-in checks: event data, team join approvals, role sync, account deletion |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | Firebase Admin service account | Same |
| `FIREBASE_ADMIN_PRIVATE_KEY` | Firebase Admin service account. Paste it on one line with each line break written as `\n`; no real line breaks, no quotes inside the value. | Same |

### C. Optional (the feature is off when unset)

| Variable | What it is | What breaks while it is unset |
|---|---|---|
| `APP_URL` | Public URL used in links inside emails | Falls back to the host's own URL variables |
| `CRON_SECRET` | Protects `/api/cron/poll-live-scores` | The poller answers 503 and does nothing |
| `RESEND_API_KEY` | Sends email through Resend | No notification emails (the app still works) |
| `EMAIL_FROM` | Sender for outgoing email | No notification emails |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key | The sign-up bot check is skipped |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret | The sign-up bot check is skipped |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob storage for photos | Photo uploads |
| `NEXT_PUBLIC_FIREBASE_VAPID_KEY` | Web push key | Push notifications |
| `APPLICATION_SECRET` | Signs team-application tokens | Falls back to a key derived from `FIREBASE_ADMIN_PRIVATE_KEY` |
| `NEXT_PUBLIC_RELEASE_OWNER_UIDS` | Optional browser copy of `RELEASE_OWNER_UIDS` | Nothing; the server reads `RELEASE_OWNER_UIDS` |

### Deliberately not read

`MIGRATION_EMAIL`, `MIGRATION_PASSWORD` (the CompSocrates app's shared login: everyone here signs in with their own account) and `TBA_KEY_ENCRYPTION_SECRET` (per-team encrypted TBA keys: this app uses the one `NEXT_PUBLIC_TBA_API_KEY`). Setting them does nothing.

## How a missing or wrong key shows up

A bad setup is reported, never hidden, and an error is never cached.

| Situation | What the person sees | Error code |
|---|---|---|
| `NEXT_PUBLIC_TBA_API_KEY` unset | "TBA key is not configured: set NEXT_PUBLIC_TBA_API_KEY." No request is sent. | `missing_credentials` |
| FIRST credentials unset | "FIRST API credentials are not configured: set FIRST_API_USERNAME and FIRST_API_TOKEN." (only the unset ones are named) | `missing_credentials` |
| TBA or FIRST answers 401/403 | "The Blue Alliance rejected the configured key: check NEXT_PUBLIC_TBA_API_KEY." (FIRST: names both FIRST variables) | `unauthorized` |
| 429 | "... rate limit was hit. Try again shortly." | `rate_limited` |
| Network failure | "Could not reach The Blue Alliance." | `network_error` |
| Any other non-2xx | "... returned 500." | `upstream_error` |
| `FIREBASE_ADMIN_*` unset | "Server sign-in is not configured: set FIREBASE_ADMIN_PROJECT_ID, ..." (only the unset names). Routes answer 503, not 401. | `server_not_configured` |
| `FIREBASE_ADMIN_PRIVATE_KEY` present but malformed | "Server sign-in could not start: check FIREBASE_ADMIN_PRIVATE_KEY ..." | `server_not_configured` |
| Not signed in | "Sign in to view event data." | `unauthorized` |
| `CRON_SECRET` unset | The poller answers 503 "CRON_SECRET is not configured". A wrong secret is 401. | n/a (route) |

Teams, rankings and qualification matches fall back to the FIRST API when TBA fails; if the fallback fails too, the TBA error (the one naming `NEXT_PUBLIC_TBA_API_KEY`) is the one reported. Playoff matches have no fallback. The live-score routes also return a `warnings` list when the TBA key is unset, because the poller skips matches it cannot fetch.

Event names are resolved by the chain API name, then a name stored in the team's data, then `config/event-names.ts`, then the raw key (`lib/events/names.ts`). One season-wide request (`getEvents({ season })`) names every event of a year, cached for 30 minutes, retried with a short backoff for transient errors and never cached on failure. When it fails, the name falls back quietly (the reason is in the tooltip) and, on the Event Select page, an admin sees "Event names could not be loaded: <message>" for the errors only they can fix (`missing_credentials`, `server_not_configured`, a rejected key).

On the client, `useEventQuery` (`lib/events/use-event-query.ts`) caches only successful results, so an error is retried on the next render or refetch. The server-side request cache (`lib/frc/http.ts`) drops every rejected request as well.

## Outbound API inventory

Every host the code calls or loads, from a grep of `app/`, `components/`, `lib/`, `config/` and `data/`. All are FRC or neutral services; there is no FTC host.

| Host | Used for | Where | Key | Kind |
|---|---|---|---|---|
| `www.thebluealliance.com/api/v3` | Events, teams, matches, rankings (primary source) | `lib/frc/tba.ts` through `lib/frc/http.ts`, base URL in `config/event.ts` | `NEXT_PUBLIC_TBA_API_KEY` (server only) | FRC |
| `frc-api.firstinspires.org/v3.0` | Practice schedule; fallback for teams, rankings, qualification matches | `lib/frc/first.ts` through `lib/frc/http.ts`, base URL in `config/event.ts` | `FIRST_API_USERNAME` + `FIRST_API_TOKEN` (HTTP Basic, server only) | FRC |
| `api.statbotics.io/v3` | EPA ratings | `lib/frc/statbotics.ts` through `lib/frc/http.ts`, base URL in `config/event.ts` | none | FRC |
| `www.youtube.com/oembed` | Looks up a pasted livestream's title to guess the event | `app/api/live/detect-event/route.ts` (server) | none | Neutral |
| `www.youtube.com/iframe_api`, `www.youtube.com/embed/...` | Embedded match video player | `components/video/youtube.ts`, `lib/live/stream.ts` (browser) | none | Neutral |
| `player.twitch.tv` | Embedded Twitch livestream | `lib/live/stream.ts` (browser iframe) | none | Neutral |
| Firebase (`*.googleapis.com`, `www.gstatic.com`) | Auth, Firestore, Cloud Messaging, Admin SDK | `lib/firebase/client.ts`, `lib/firebase/admin.ts`, `app/firebase-messaging-sw.js/route.ts` (loads the Firebase scripts from `www.gstatic.com`) | `NEXT_PUBLIC_FIREBASE_*` (browser), `FIREBASE_ADMIN_*` (server), `NEXT_PUBLIC_FIREBASE_VAPID_KEY` | Neutral |
| `api.resend.com` | Notification email | `lib/server/email.ts` | `RESEND_API_KEY`, `EMAIL_FROM` | Neutral |
| `challenges.cloudflare.com` | Turnstile bot check (script in the browser, verification on the server) | `components/auth/turnstile.tsx`, `lib/server/turnstile.ts` | `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Neutral |
| `*.public.blob.vercel-storage.com` | Photo storage (uploads go through `@vercel/blob`) | `app/api/blob/*`, `lib/blob/*` | `BLOB_READ_WRITE_TOKEN` | Neutral |
| `lh3.googleusercontent.com` | Google profile pictures (displayed only) | `lib/profile/model.ts` | none | Neutral |
| `fonts.googleapis.com` | Fonts, fetched at build time by `next/font` | `app/layout.tsx` | none | Neutral |
| `frc-events.firstinspires.org`, `www.thebluealliance.com` (links only) | "Data Sources" credit links | `components/events/data-source-credits.tsx` | none | FRC |

Notes:

- The three FRC data hosts are named once, in `config/event.ts`. Nothing else in the code builds a TBA, FIRST or Statbotics URL.
- Keys are sent only from the server. The browser never sees the TBA or FIRST credentials.
- A test (`lib/server/no-ftc.test.ts`) fails the test run if an FTC host (`ftc-api`, `ftc-events`), an `FTC_` variable, `EVENT_PROGRAM` or the words "FIRST Tech" appear in the source.
- Tests mock `fetch`; none of them reaches a real API, and none touches a real Firebase project.
