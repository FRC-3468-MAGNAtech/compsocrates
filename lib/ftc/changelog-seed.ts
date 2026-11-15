import type { StarterEntry } from "@/lib/changelog/seed";

// Starter changelog drafts for the FTC program (Batch 5a). Same mechanism and shape as the other program's starter drafts (lib/changelog/seed.ts): they are created as
// DRAFTS the first time an admin opens the Changelog, so nothing is published on anyone's behalf and nobody gets an unread badge until an admin publishes. An
// admin edits the wording and publishes. The doc id is `starter-{teamId}-{key}`, so seeding twice never duplicates.
//
// Every line names a page or feature that exists in FTC mode today (each page is in `connection.paths` of config/programs/ftc.ts). The dates are the real dates the
// work landed in git history (`git log`, 2026-11-13 to 2026-11-15); the version labels are only a suggested numbering. Plain wording, easy to change.

export const FTC_STARTER_ENTRIES: StarterEntry[] = [
  {
    key: "v0-1-0",
    version: "v0.1.0",
    title: "Match scouting and the tables behind it",
    date: "2026-11-13",
    summary: "Scout a BIOBUZZ match and see what your team collected in tables.",
    changes: [
      { type: "new", text: "**Match Scout Form** — pick a match and a team, then record what the robot did." },
      { type: "new", text: "**Active Events** — choose the events your team is at." },
      { type: "new", text: "**Match List** — the matches of your active events." },
      { type: "new", text: "**Match Scout Analytics** — every scout entry in one table, with a way to review, fix or remove an entry (admins)." },
    ],
  },
  {
    key: "v0-2-0",
    version: "v0.2.0",
    title: "The team's other forms, Dashboard and Pick List",
    date: "2026-11-13",
    summary: "Six more forms for the rest of your scouting, and a place to put the results together.",
    changes: [
      { type: "new", text: "**Lead Scout**, **Pit Scout**, **Team Strategy**, **Match Strategy**, **Drive Reflection** and **Helper** forms, each with its own table in Analytics." },
      { type: "new", text: "**Dashboard** and **My Scouting** — what matters for your role at the event, and your own accuracy, activity and rank." },
      { type: "new", text: "**Pick List** — one shared list for the team to rank the teams you may pick." },
    ],
  },
  {
    key: "v0-3-0",
    version: "v0.3.0",
    title: "People, join requests and assignments",
    date: "2026-11-14",
    summary: "Bring teammates in and plan who scouts what.",
    changes: [
      { type: "new", text: "**People** and **Team Management** — see your teammates and, as an admin, set their roles." },
      { type: "new", text: "**Join requests** — a teammate asks to join with your team's code and an admin approves or denies it." },
      { type: "new", text: "**Assignments** — mark who is attending an event and share who scouts which match." },
      { type: "new", text: "**Hive and Garden roles** — in a BIOBUZZ match one scout per alliance records the alliance's own objectives, so they are not counted twice." },
      { type: "new", text: "**Credits** — the people, tools and data behind the app." },
    ],
  },
  {
    key: "v0-4-0",
    version: "v0.4.0",
    title: "Practice, accuracy and the Admin Panel",
    date: "2026-11-15",
    summary: "Practice on scheduled matches, check how accurate your scouts are, and manage the team from the Admin Panel.",
    changes: [
      { type: "new", text: "**Practice Scouting** — scout a scheduled match on your own and compare it with the official score when there is one." },
      { type: "new", text: "**Scout Accuracy** — how close each scout's practice results are to the official scores." },
      { type: "new", text: "**CSV import** — add scouting entries from a file; importing the same file twice adds nothing new." },
      { type: "new", text: "**Admin Panel** — Match Library (the matches Practice Scouting uses), Page Access, Sidebar, Submissions and Audit Log." },
    ],
  },
  {
    key: "v0-5-0",
    version: "v0.5.0",
    title: "Team Settings and this changelog",
    date: "2026-11-15",
    summary: "Run several teams from one account, and keep track of what changes.",
    changes: [
      { type: "new", text: "**Team Settings** — add, rename or remove the teams your account scouts for, and choose which teams each member can switch to." },
      { type: "new", text: "**Form for each season** — choose which match form your scouts fill in for a season." },
      { type: "new", text: "**Changelog** — this page. Admins write and publish the entries." },
    ],
  },
];
