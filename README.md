# CompSocrates (rebuild)

Scouting for FIRST Robotics Competition teams: match, pit, lead, strategy and drive-reflection forms, assignments, practice scouting, and analytics. This is CompSocrates rebuilt on CompEpicurus's stack and design, so the two can later be merged into one site. It reads and writes the existing CompSocrates Firestore data.

- `docs/AUDIT.md`: what was found in both apps before any code was written.
- `docs/ROUTES.md`: the route map (old CS URL to new URL) and the decision log.
- `docs/REMAINING.md`: what is not done, and known gaps.
- `config/README.md`: where event, game and API settings live.
- `CLAUDE.md`: conventions and rules for working in this repo.

## Run it
```bash
npm install
cp .env.example .env.local   # fill in Firebase, TBA and FIRST credentials
npm run dev
```
Never point a development environment at the production Firebase project. Use the emulators (below) or a copy.

## Check it
```bash
npm run lint
npm test                 # unit tests (Vitest)
npm run build            # runs the theme contrast guard, then the production build
npm run test:rules       # Firestore rules, API routes and adapter against the local emulators
npm run test:e2e         # Playwright (needs `npx playwright install chromium webkit` once)
```
`test:rules` needs Java and the Firebase CLI. It uses the demo project id in `.firebaserc`, which cannot reach a real project.

## Stack
Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind 4 with generated theme tokens, Radix primitives, Firebase (Auth, Firestore, Admin SDK), Vitest and Playwright.
