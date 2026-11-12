# Deployment (Vercel and Firebase)

CompSocrates deploys on Vercel. Firebase provides Auth and Firestore only: no Cloud Functions and no Firebase Hosting. Server-side work (event-data proxying, team and join routes, the live-score poller, push sending) runs as Next.js Route Handlers and Server Actions, which Vercel runs as serverless functions with nothing extra to configure.

Before the first deploy, read `docs/REMAINING.md` ("Not verified"): nothing here has been run against a real Firebase project yet. Use a staging project first. Never point a development or test environment at the production project, and compare `firestore.rules` with the live rules before deploying them (the open spots in CompSocrates's production rules are described in `docs/SECURITY-NOTES.md`, which stays local).

## 1. Vercel project

Import the repo into Vercel as a Next.js app (framework preset: Next.js). The build command is the default `npm run build`, which runs the theme contrast guard first. `vercel.json` only sets one daily cron entry (see section 8); no rewrites are needed because the App Router is file-routed and server-rendered.

## 2. Environment variables

Set them in Vercel under Project Settings > Environment Variables, for **Production** and **Preview**. The names must match `.env.example` exactly.

The full table (what each variable is, what breaks while it is unset, which are optional) is in **`docs/ENVIRONMENT.md`**; it is not repeated here. In short:

- **Firebase web config** (`NEXT_PUBLIC_FIREBASE_*`) and the **TBA and FIRST keys** are needed for sign-in and event data.
- **Firebase Admin** (`FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY`; the project id comes from `NEXT_PUBLIC_FIREBASE_PROJECT_ID`) is required for every server route that verifies a sign-in.
- **Owner** variables (`RELEASE_OWNER_UIDS` and/or `RELEASE_OWNER_EMAILS`) say who the platform owner is.
- Everything else (`APP_URL`, `CRON_SECRET`, Resend, Turnstile, Blob, push, `APPLICATION_SECRET`) is optional and switches one feature on.

After deploying, a signed-in admin can open **Admin Panel > Setup Check** to see which variables are still missing (names only, never values).

### The Firebase Admin service account

1. Firebase Console > Project Settings > Service Accounts > **Generate new private key**. A JSON file downloads.
2. Copy two fields from it: `client_email` to `FIREBASE_ADMIN_CLIENT_EMAIL`, `private_key` to `FIREBASE_ADMIN_PRIVATE_KEY`. Never add `NEXT_PUBLIC_` to these. The project id is the web app's `NEXT_PUBLIC_FIREBASE_PROJECT_ID` (set `FIREBASE_ADMIN_PROJECT_ID` only to override it).
3. **Escaping the private key.** The JSON's `private_key` is one string with literal `\n` sequences marking line breaks. Paste it on one line exactly like that, `\n` included, with no real line breaks. Most dashboards accept only single-line values, so `lib/firebase/admin.ts` turns the `\n` sequences back into real newlines at runtime. Do not wrap the value in quotes; if the value arrives wrapped in literal quotes the code strips them and logs it, but it is easy to miss by eye. A malformed key shows up as "Server sign-in could not start: check FIREBASE_ADMIN_PRIVATE_KEY" and routes answer 503.

## 3. Sign-in providers and authorized domains

- Firebase Console > Authentication > Sign-in method: enable **Email/Password** and **Google** (Google needs a support email). Nothing in the app needs reconfiguring once they are on.
- Authentication > Settings > **Authorized domains**: add your production domain (a custom domain or the `*.vercel.app` one). Google sign-in and password-reset links fail on a domain that is not listed. Firebase does not support wildcards, and every preview deployment gets a new subdomain, so add a specific preview domain when you need Google sign-in there; ordinary email and password sign-in does not depend on it.

## 4. Firestore rules and indexes

`firebase.json` points at `firestore.rules` and `firestore.indexes.json`. The repo's `.firebaserc` only names the demo emulator project, so pass the real project explicitly:

```bash
firebase deploy --only firestore:rules,firestore:indexes --project <your-project-id>
```

Deploy the rules **before or together with** the app: the app reads and writes collections that need the rebuild's rule blocks, and a missing rule shows up as an empty list or a denied save. The rules keep CompSocrates's production behavior for every collection the CompSocrates app already has and add blocks for the collections this app needs (flag states, announcements, sub-in requests, forms, templates, profiles, applications, audit logs and others). Compare with the live rules first if the project already runs the CompSocrates app. Server-written collections (applications, rate limits and similar) can optionally get a Firestore **TTL policy** on the `expiresAt` field of the `rateLimits` collection group (Firebase Console > Firestore > TTL); nothing depends on it.

## 5. First sign-in: owner and teams

- The platform owner is whoever matches `RELEASE_OWNER_UIDS` or a **verified** email in `RELEASE_OWNER_EMAILS`. The sign-in sync (`/api/auth/sync-roles`) gives them the `platformOwner` claim, so sign out and back in once after setting the variables.
- A signed-in person creates a team (a random join code becomes the team document id) or asks to join one; a team admin approves join requests under Team Management. Public team creation is controlled by `appSettings/global.teamCreationEnabled`: with no setting yet it is on only while no team exists, and creating a team switches it off again. The platform owner turns it on or off in the Admin Panel. Other teams can also apply at `/apply`, and the platform owner approves each application in the Admin Panel.
- Event data calls require a signed-in user and the Admin credentials: without them every event request fails with a named error (see `docs/ENVIRONMENT.md`) rather than serving data to anyone.

## 6. Local development

```bash
npm install
cp .env.example .env.local   # fill in real values; never commit .env.local
npm run dev
```

`next dev` runs the API routes alongside the pages; no `vercel dev` is needed. To work against the local emulators instead of a project, run `firebase emulators:start --only firestore,auth` and set `NEXT_PUBLIC_USE_FIREBASE_EMULATOR=1` in `.env.local`.

## 7. Emulator tests

`npm run lint`, `npm test` and `npm run build` need nothing extra. `npm run test:rules` needs a JVM and the Firebase CLI (`npm install -g firebase-tools`). It boots the Firestore and Auth emulators under the demo project in `.firebaserc` (it cannot reach a real project) and runs three files one after another against them:

- `firestore.rules.test.ts` (the rules),
- `api-routes.emulator.test.ts` (the server routes, with real Admin SDK calls against the emulator),
- `data/cs/adapter.emulator.test.ts` (the CS data adapter run as signed-in users against the real rules).

To run one file: `firebase emulators:exec --only firestore,auth "npx vitest run --config vitest.rules.config.ts <file>"`. Browser tests: `npm run test:e2e` (run `npx playwright install chromium webkit` once).

## 8. Optional services

### Push notifications (Firebase Cloud Messaging)

1. Firebase Console > Project Settings > Cloud Messaging > **Web Push certificates** > Generate key pair. Put it in `NEXT_PUBLIC_FIREBASE_VAPID_KEY`.
2. Nothing else: `lib/notifications.ts` registers `/firebase-messaging-sw.js` (a Route Handler, so it can read the `NEXT_PUBLIC_FIREBASE_*` config at request time) and the Admin SDK side uses the same `FIREBASE_ADMIN_*` credentials.
3. **iOS:** Safari delivers web push only to a site added to the Home Screen. That is a platform limit; the Enable notifications button explains it.
4. Not verified on a real device. After deploying, enable notifications on a phone and a desktop browser, trigger `/api/cron/poll-live-scores` for a session of yours, and check that a notification arrives with the tab open and closed.

### Scheduling the live-score poller

`/api/cron/poll-live-scores` needs `CRON_SECRET`; the request must send `Authorization: Bearer <CRON_SECRET>`. Unset means the route answers 503; a wrong secret is 401. Vercel's own cron (the `vercel.json` entry) runs once a day on the Hobby plan, which is only a floor. For a run every 2 to 5 minutes during an event use an external scheduler: **cron-job.org** (a job with a custom `Authorization` header) or a **GitHub Actions** `schedule:` workflow with a `curl` step and a repo secret. Check that the route answers `{ checked, resolved }` and not 401, and that the scheduler's secret equals the one in Vercel. Vercel's own cron calls send the header automatically. The client fallback (`/api/live/check-scores`, polled while someone has the app open with a pending live session) needs no scheduler.

### Email (Resend)

Used for new-application notices, applicant receipts and decisions, and ownership-transfer notices. Create an account at <https://resend.com>, verify a sending domain, create an API key, then set `RESEND_API_KEY`, `EMAIL_FROM` (a sender on that domain, for example `CompSocrates <notify@yourdomain.org>`) and `APP_URL`. With the first two unset nothing is sent and nothing breaks: every notice is also shown in the app, and an email failure never fails a request.

### Bot check (Cloudflare Turnstile)

Protects the team application form. In the Cloudflare dashboard open **Turnstile** > **Add site**, name it, add your production domain (and a preview or `localhost` domain if you test there), widget mode **Managed**. Put the **Site key** in `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and the **Secret key** in `TURNSTILE_SECRET_KEY`, then redeploy. Set both or neither: the Applications tab in the Admin Panel warns if the server has a secret but the browser has no site key (every application would be refused) or if neither is set (applications are then protected only by the honeypot, timing check, rate limits and disposable-email filter).

### Photo uploads (Vercel Blob)

The form `image` field stores photos in Vercel Blob. Until a store is connected, `/api/blob/upload` and `/api/blob/delete` answer `503 not-configured` and the app keeps working.

1. Vercel dashboard > your project > **Storage** > create a **Blob** store with **Public** access.
2. Connect it to the project for Production and Preview (and Development if offered); Vercel adds `BLOB_READ_WRITE_TOKEN`.
3. For local development run `vercel env pull .env.local`, or copy the token into `.env.local`. Never commit it.
4. Redeploy.

What to know: uploads go straight from the browser to Blob, and `/api/blob/upload` only issues a one-use token after checking the signed-in user and their team, so photo bytes never pass through a function (the app compresses to about 1600 px and caps files at 6 MB). Blob URLs are public but unguessable (128 bits of randomness, no user-entered text), so anyone who has a URL can view the photo: do not treat photos as private. Only the uploader, or an admin or owner of the same team, can delete a photo. Photos wait in the browser (IndexedDB) while offline and upload when the connection returns. The free plan has storage and transfer limits; check Vercel's current numbers and watch the store's usage during the season.

## 9. Before you call a deploy done

- `npm run lint`, `npm test`, `npm run test:rules` and `npm run build` pass.
- Environment variables set for Production and Preview; Admin Panel > Setup Check shows nothing missing.
- Production domain in Firebase authorized domains; rules deployed (and compared with the live ones).
- Sign out and in once as the platform owner so the token carries the owner claim.
