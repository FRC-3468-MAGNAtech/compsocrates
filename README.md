# CompSocrates

CompSocrates is a Next.js scouting and analytics app for FRC teams. The current preview branch uses Firebase, modular role-gated pages, and a light Greek-Tech interface built around white/slate surfaces, metallic gold accents, crimson highlights, and frosted glass cards.

## Development

```bash
npm run dev
npm run build
npm run lint
```

## New Core Modules

- Team Management: `/team-management` manages members, roles, join requests, owner verification metadata, roster search, and per-metric public visibility rules.
- Form Builder: `/form-builder` lets team leads build match and pit scouting schemas, save team presets, set active presets, import/export JSON, and add fields from the historical objective library.
- Lead Scout Verification: `/analytics/accuracy-verification` compares junior scouting entries against lead scout logs and labels close matches as verified.
- Prediction Engine: `/match-strategy-form` pre-fills robot start position, tactical role, climb probability, and point estimate from historical scouting data.
- Submission Controls: `/admin` includes a global team lockout that prevents new submissions across the primary scouting forms while still allowing edits.

See `ARCHITECTURE.md` for Firestore shapes, privacy rules, verification math, and role permissions.
