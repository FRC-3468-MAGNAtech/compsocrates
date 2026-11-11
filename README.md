# CompSocrates

Scouting for FIRST Robotics Competition (FRC) teams: match, pit, lead, strategy and drive-reflection forms, assignments, practice scouting, analytics, a Judge Book and event details. It reads and writes the existing CompSocrates Firestore data through an adapter, so it can share a project with the CompSocrates app. Three games are supported and submittable: REBUILT (2026), REEFSCAPE (2025) and CHARGED UP (2023).

## Run it
```bash
npm install
cp .env.example .env.local   # fill in Firebase, TBA and FIRST credentials
npm run dev
```
`docs/ENVIRONMENT.md` explains every variable. Never point a development environment at the production Firebase project: use the emulators (below) or a copy.

## Check it
```bash
npm run lint
npm test                 # unit tests (Vitest)
npm run build            # runs the theme contrast guard, then the production build
npm run test:rules       # Firestore rules, API routes and adapter against the local emulators
npm run test:e2e         # Playwright (needs `npx playwright install chromium webkit` once)
```
`test:rules` needs Java and the Firebase CLI. It uses the demo project id in `.firebaserc`, which cannot reach a real project.

## Docs
- `docs/CS-REFERENCE.md`: what the CompSocrates app does and how it stores data (collections, the three games and their scoring, routes, data-compatibility notes).
- `docs/ROUTES.md`: the route map (old URL to new URL) and the decision log.
- `docs/REMAINING.md`: what is not done, and known gaps.
- `docs/ENVIRONMENT.md`: every environment variable and every outside service the code calls.
- `docs/DEPLOYMENT.md`: Vercel and Firebase setup, rules deploy, optional services, emulator tests.
- `docs/MOBILE.md`: the mobile audit and what still needs a real device.
- `docs/SECURITY-NOTES.md`: open-access findings about the production Firestore rules and the old app. Sensitive and **local only**: do not publish it to a public repository.
- `config/README.md`: where brand, event, game and API settings live.
- `CLAUDE.md`: conventions and rules for working in this repo.

## Stack
Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind 4 with generated theme tokens, Radix primitives, Firebase (Auth, Firestore, Admin SDK), Vitest and Playwright.
