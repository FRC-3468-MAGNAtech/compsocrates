# Local development without touching production

`npm run dev` reads whatever `.env.local` holds. If that file has the production web config, every page load and every hot reload on your machine is billed against the
production project's 50,000 free reads a day (React development mode also mounts each listener twice). Use one of the two setups below instead.

## 1. The emulators (recommended): `npm run dev:emu`

Needs Node, Java 21 and the Firebase CLI (the same as `npm run test:rules`). From the repository root, in PowerShell:

```powershell
cd "C:\Users\<you>\VSC Projects\compsocrates-rebuild\CompSocrates rebuild"
npm run dev:emu
```

It starts the Firestore and Auth emulators for the demo project `demo-compsocrates-rebuild`, seeds a small synthetic dataset, and starts `next dev` pointed at them:

- `NEXT_PUBLIC_USE_FIREBASE_EMULATOR=1`, demo web config values, `FIRESTORE_EMULATOR_HOST` and `FIREBASE_AUTH_EMULATOR_HOST` (set by `firebase emulators:exec`).
- A throwaway RSA key generated in memory for `FIREBASE_ADMIN_PRIVATE_KEY` (the server routes need a service-account shape). It is never written to a file.
- Values set by the script win over any `.env*` file, so a `.env.local` with production keys cannot reach production through this command. The scripts never read a `.env` file.

Then open <http://localhost:3000>. Accounts (password `password1234` for all): `owner@dev.test` (team admin), `lead@dev.test`, `scout1@dev.test`, `scout2@dev.test`,
`scout3@dev.test`. Each program has one team (`DEVFRC1`, `DEVFTC1`) and 20 entries. The emulator UI is <http://localhost:4000>. Stopping the command (Ctrl+C) stops the emulators;
the data is gone (it is rebuilt on the next start). The seed is `scripts/dev-emu-seed.ts` (synthetic, nothing from production).

Limits: the emulator is empty apart from the seed (no match library, no FIRST API data), and the server routes that call the FIRST/TBA APIs still need their own keys.

## 2. A separate free Firebase project

A second project on the Spark plan has its own 50,000-read, 20,000-write and 20,000-delete daily quotas, separate from production. Create it in the Firebase console (use a name that
says dev), enable Firestore and Email/Password and Google sign-in, then:

1. Copy its web config into `.env.local` as `NEXT_PUBLIC_FIREBASE_*` and make a service account for `FIREBASE_ADMIN_CLIENT_EMAIL` / `FIREBASE_ADMIN_PRIVATE_KEY` (see `docs/ENVIRONMENT.md`).
2. Deploy the rules and indexes to THAT project only: `firebase deploy --only firestore --project <your-dev-project-id>`.
3. Check `NEXT_PUBLIC_FIREBASE_PROJECT_ID` in `.env.local` before every `npm run dev`. If it is the production project id, stop.

## Counting reads while you develop

Open any page with `?readmeter=1` (an admin account) to show a device-only counter of the documents that page load has read; `?readmeter=0` hides it. It works against the emulator
too, and sends nothing anywhere. The shared meter and its Admin Panel tab are described in `docs/READ_REDUCTION_RESULTS.md`.
