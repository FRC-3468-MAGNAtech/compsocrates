import { BRAND } from "@/config/brand";
import { PROGRAMS, isPathConnected } from "@/config/programs";
import { PROGRAM_IDS, type ProgramConfig, type ProgramId } from "@/config/programs/types";
import type { ChangeType } from "@/lib/changelog";
import type { EntryInput, PlatformItem } from "@/lib/platform-changelog/model";

// The "Start from the v2.0.0 template" draft (Session 7, optional task). It FILLS THE EDITOR FORM; nothing is saved until the owner presses Save.
// Every item describes a feature that exists in the code today, in plain words, for what a scout or team admin would notice, and carries the file
// that proves it (`proof`, listed in docs/SESSION7_RESULTS.md and checked to exist by the test). An item's program tags are NOT typed in: they are
// computed from each program's config (`applies`), so the tags cannot drift from what a program really has. Nothing here names internal tooling.

export type TemplateItem = {
  category: ChangeType;
  text: string;
  /** Does this program have the feature? The item is tagged for exactly the programs where this is true. */
  applies: (program: ProgramConfig, id: ProgramId) => boolean;
  /** The file that shows the feature exists (a path relative to the repository root). */
  proof: string;
};

export const V2_VERSION = "v2.0.0";
export const v2Title = () => `${BRAND.name} ${V2_VERSION}`;

export const V2_TEMPLATE_ITEMS: readonly TemplateItem[] = [
  {
    category: "new",
    text: "Admins can arrange the sidebar for their team in Admin Panel > Sidebar: reorder pages, put them in groups, rename them, or hide the ones you don't use.",
    applies: (p) => p.admin.tabs.includes("sidebar"),
    proof: "components/admin/sidebar-panel.tsx",
  },
  {
    category: "new",
    text: "Admins can choose which roles can open which pages in Admin Panel > Page Access.",
    applies: (p) => p.admin.tabs.includes("page-access"),
    proof: "components/page-access/page-access-panel.tsx",
  },
  {
    category: "new",
    text: "Practice Scouting has Live practice, where you scout a real, livestreamed match, and Lobby practice, where scouts practice together in a shared lobby.",
    applies: (p) => p.connection.features.live && p.connection.features.lobby,
    proof: "components/practice/lobby/lobby-flow.tsx",
  },
  {
    category: "new",
    text: "The Scout Accuracy page shows how closely each scout's entries match the official match results.",
    applies: (p, id) => p.connection.features.accuracy && isPathConnected(id, "/scout-accuracy"),
    proof: "app/(app)/[program]/scout-accuracy/page.tsx",
  },
  {
    category: "new",
    text: "Admins can import scouting entries from a CSV file.",
    applies: (p) => p.connection.features.csvImport,
    proof: "components/analytics/import-csv-dialog.tsx",
  },
  {
    category: "new",
    text: "Analytics has a Robot Radar page that compares a team's strengths on a radar chart.",
    applies: (_p, id) => isPathConnected(id, "/analytics/robot-radar"),
    proof: "components/analytics/robot-radar-chart.tsx",
  },
  {
    category: "new",
    text: "Analytics has a Pick List page.",
    applies: (p, id) => p.connection.features.pickList && isPathConnected(id, "/analytics/pick-list"),
    proof: "app/(app)/[program]/analytics/pick-list/page.tsx",
  },
  {
    category: "new",
    text: "One account can belong to several teams: admins add them in Team Settings, and a team switcher appears for anyone with more than one.",
    applies: (p) => p.multiTeam,
    proof: "components/team/account-teams-section.tsx",
  },
  {
    category: "improved",
    text: "There is now one Changelog for the whole site. It shows the notes for your program by default; turn on Show all programs to see everything.",
    applies: () => true,
    proof: "app/(app)/[program]/changelog/page.tsx",
  },
  {
    category: "new",
    text: "Credits is now a public page that anyone can open at /credits, with a link in the footer.",
    applies: () => true,
    proof: "app/(marketing)/credits/page.tsx",
  },
];

/** The template as editor input: titled "CompSocrates v2.0.0", default tag for every program, each item tagged by what its programs really have. */
export function v2Template(todayIso: string): EntryInput {
  const items: PlatformItem[] = [];
  for (const t of V2_TEMPLATE_ITEMS) {
    const tags = PROGRAM_IDS.filter((id) => t.applies(PROGRAMS[id], id));
    if (tags.length === 0) continue; // a feature no program has is not described
    items.push({ category: t.category, text: t.text, ...(tags.length === PROGRAM_IDS.length ? {} : { programs: tags }) });
  }
  return { title: v2Title(), version: V2_VERSION, date: todayIso, programs: [...PROGRAM_IDS], items };
}
