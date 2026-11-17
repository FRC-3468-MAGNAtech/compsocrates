import { BRAND } from "@/config/brand";
import { PROGRAM_IDS, type ProgramId } from "@/config/programs/types";
import type { ChangeType } from "@/lib/changelog";
import type { EntryInput, PlatformItem } from "@/lib/platform-changelog/model";

// The approved "CompSocrates v2.0.0" changelog entry (the owner's final wording), in ONE module. The editor's "Start from the v2.0.0 template" button
// (`template.ts`) and the seed script (`seed.ts`, `scripts/seed-changelog-draft.ts`) both import it, so they cannot diverge. Program tags are explicit
// DATA on each item (not computed): a program id here is a tag value, never something a component compares. `proof` is a repository path that shows the
// feature in the code (the test checks the file exists); it is NOT part of the stored entry.

export const V2_VERSION = "v2.0.0";
export const v2Title = () => `${BRAND.name} ${V2_VERSION}`;

/** The entry-level default tags: every program. */
export const V2_DEFAULT_PROGRAMS: readonly ProgramId[] = PROGRAM_IDS;

export type V2Item = {
  category: ChangeType;
  text: string;
  /** Explicit tags: both programs, or the one program the item is for. */
  programs: readonly ProgramId[];
  /** A file in the repository that shows the feature (or, for a removed one, the current state). Not stored. */
  proof?: string;
};

const BOTH: readonly ProgramId[] = PROGRAM_IDS;
const FRC_ONLY: readonly ProgramId[] = ["frc"];
const FTC_ONLY: readonly ProgramId[] = ["ftc"];

const item = (category: ChangeType, programs: readonly ProgramId[], text: string, proof?: string): V2Item => ({ category, programs, text, ...(proof ? { proof } : {}) });

export const V2_ITEMS: readonly V2Item[] = [
  // --- NEW (24) ---
  item("new", BOTH, `FIRST Tech Challenge: CompSocrates now supports FTC as well as FRC. Pick your program on the landing page and switch between them any time`, "config/programs/ftc.ts"),
  item("new", BOTH, `Redesign: a new look and layout across the whole site`),
  item("new", BOTH, `Sidebar Customization: admins can rearrange, rename, hide, and group sidebar pages for their team (Admin Panel > Sidebar). By default, all forms are under one "Forms" menu`, "components/admin/sidebar-panel.tsx"),
  item("new", BOTH, `Achievements: a new Achievements page with progress bars. Admins can create, rename, and hide achievements (Admin Panel > Achievements)`, "components/admin/achievements-panel.tsx"),
  item("new", BOTH, `Form Seasons: every form has a season dropdown, and forms are named by their game, like "REBUILT Match Scout Form"`, "lib/forms/form-display-name.ts"),
  item("new", BOTH, `Form Submissions: admins can turn off submitting for the whole team or for a single season (Admin Panel > Form Submissions)`, "components/admin/submission-controls-panel.tsx"),
  item("new", BOTH, `Archived Events: archive past events in Active Events so they stop cluttering your pickers, and restore them any time (admins only)`, "components/event/archived-events-section.tsx"),
  item("new", BOTH, `My Scouting: a page for your own scouting, with filters that only list your roles and events, and a Game select`, "app/(app)/[program]/my-scouting/page.tsx"),
  item("new", BOTH, `Changelog: one changelog for the whole site, with each change tagged FRC or FTC and a "Show all programs" option`, "app/(app)/[program]/changelog/page.tsx"),
  item("new", BOTH, `Credits: one Credits page for the whole site, reachable from the landing page without signing in`, "app/(marketing)/credits/page.tsx"),
  item("new", FRC_ONLY, `CHARGED UP: the 2023 game is now available in forms, Practice Scouting, and Analytics`, "config/games/charged-up.ts"),
  item("new", FRC_ONLY, `Match Prediction: a new analytics page that estimates how a match may play out from your team's scouted stats`, "app/(app)/[program]/analytics/match-prediction/page.tsx"),
  item("new", FRC_ONLY, `Team Communication: post announcements, strategy notes, and match alerts for your team (Team Management)`, "components/announcements/announcements-panel.tsx"),
  item("new", FTC_ONLY, `BIOBUZZ Scouting: Match Scout Form, scoring, and Analytics for the BIOBUZZ game`, "config/games/ftc/biobuzz.ts"),
  item("new", FTC_ONLY, `Hive and Garden Roles: when both scouts of an alliance are assigned, one records the Hive objectives and the other records the Garden objectives, picked automatically each match`, "lib/forms/alliance-role.ts"),
  item("new", FTC_ONLY, `Scouting Forms: Match Scout, Pit Scout, Team Strategy, Match Strategy, Drive Reflection, Helper, and Lead Scout Forms, each with a notes panel`, "app/(app)/[program]/pit-scout-form/page.tsx"),
  item("new", FTC_ONLY, `Practice Scouting: solo, live, and lobby practice, with accuracy scores once a match has an official score`, "components/practice/lobby/lobby-flow.tsx"),
  item("new", FTC_ONLY, `Scout Accuracy: accuracy scores from practice scouting`, "app/(app)/[program]/scout-accuracy/page.tsx"),
  item("new", FTC_ONLY, `Analytics: a page for every form (Match Scout, Lead Scout, Pit Scout, Team Strategy, Match Strategy, Drive Reflection, and Helper), plus Team Averages, Team Breakdown, Match Breakdown, Rankings, Pick List, Scout Status, Robot Radar, and Performance Reliability`, "app/(app)/[program]/analytics/page.tsx"),
  item("new", FTC_ONLY, `Events: Active Events, Assignments, and Match List with FTC schedules, plus a page for every event`, "app/(app)/[program]/match-list/page.tsx"),
  item("new", FTC_ONLY, `Match Library: admins can add practice matches by hand or import them from the FTC schedule, and enter official scores (Admin Panel > Match Library)`, "components/admin/match-library-panel.tsx"),
  item("new", FTC_ONLY, `Field Teams: manage more than one robot team under your FTC team, assign members to each, and switch between them (Team Settings)`, "components/team/account-teams-section.tsx"),
  item("new", FTC_ONLY, `Join Requests: admins can approve or deny people joining with a team code (Team Management)`, "data/ftc/join-requests.ts"),
  item("new", FTC_ONLY, `Admin Panel: Forms and templates, Page Access, Sidebar, Achievements, Form Submissions, Sessions, Rescore, Audit Log, and Backups`, "config/programs/ftc.ts"),

  // --- IMPROVED (16) ---
  item("improved", BOTH, `Themes: new solid and gradient themes with light and dark modes, plus more pride flag gradients (20 in all). Flags have one color set, so they have no light or dark mode`, "lib/themes.ts"),
  item("improved", BOTH, `Page Access: every page is listed for every role, and a new "All Members" chart shows each member's access at a glance (admins only)`, "components/page-access/members-matrix.tsx"),
  item("improved", BOTH, `Form Builder: now in Admin Panel > Forms, where you can create or edit forms and save them as templates`, "components/forms/builder/builder.tsx"),
  item("improved", BOTH, `Profile Visibility: team admins can now see every profile on their team, regardless of its visibility setting`, "lib/profile/admins-see-all.ts"),
  item("improved", BOTH, `All Events: Analytics "All Events" now combines only the events of the selected game, so different games never mix`, "components/analytics/event-multiselect.tsx"),
  item("improved", BOTH, `Event Names: events now show their full name and year, like "Arkansas Regional 2026"`, "lib/events/names.ts"),
  item("improved", BOTH, `Analytics Events: opens on the first event of the current game's season, shows a check next to the selected event, and skips games that aren't set up yet`, "lib/analytics/event-defaults.ts"),
  item("improved", BOTH, `Analytics Tables: long text wraps inside its column, Session IDs are shortened with a copy button, and pinned headers no longer show text scrolling behind them`, "components/analytics/data-table.tsx"),
  item("improved", BOTH, `Analytics Buttons: Table and Summary now show their icons beside the text`, "components/analytics/form-analytics-page.tsx"),
  item("improved", BOTH, `Dropdowns: long lists now scroll instead of running off the screen`, "components/ui/select.tsx"),
  item("improved", BOTH, `Navigation: pages now open at the top`, "components/layout/scroll-to-top.tsx"),
  item("improved", BOTH, `Forms: on large screens, the notes box stays beside the form`, "components/forms/sticky-notes-panel.tsx"),
  item("improved", BOTH, `Landing Page: the FRC and FTC choices are at the top, and signed-in users no longer see Log In and Sign Up`, "components/marketing/auth-actions.tsx"),
  item("improved", BOTH, `Phones: larger tap targets, and dialogs open from the bottom of the screen`, "components/ui/dialog.tsx"),
  item("improved", BOTH, `Sign Out: your theme now clears when you sign out`, "components/theme/theme-provider.tsx"),
  item("improved", FRC_ONLY, `REBUILT Match Scout Form: new optional "Attempted climb" check, so Climb Reliability in Robot Radar has data to show`, "lib/forms/builtin-rebuilt.ts"),

  // --- FIXED (1) ---
  item("fixed", BOTH, `Assignments now show an event's name instead of its code`, "app/(app)/[program]/assignments/page.tsx"),

  // --- REMOVED (5) --- (a removed item's proof is the file that shows the current state; the removal itself is proved by absence, see docs/CHANGELOG_V2_RESULTS.md)
  item("removed", BOTH, `Profile Pictures: uploads are not available in this release`, "lib/avatar/settings.ts"),
  item("removed", BOTH, `Team Creation: teams can't be created directly. FRC teams apply and are approved, and FTC teams join an existing team with a code`, "lib/team-setup.ts"),
  item("removed", BOTH, `Account Settings: Change Email, Delete Account, Leave Team, and Cookie Preferences are not in this release`, "app/(app)/[program]/account/page.tsx"),
  item("removed", BOTH, `Admin Panel: the Blue Alliance key page and the Default Dashboard, Simulated Date/Time, and Owner User Management cards are gone`),
  item("removed", BOTH, `Themes: your saved theme resets to Team Colors. Pick another in Account Settings`, "lib/themes.ts"),
];

/** The entry as the editor and the seed script send it (validated by `parseEntryInput`). `proof` is dropped; tags are copied so nothing is shared. */
export function v2EntryInput(dateIso: string): EntryInput {
  const items: PlatformItem[] = V2_ITEMS.map((i) => ({ category: i.category, text: i.text, programs: [...i.programs] }));
  return { title: v2Title(), version: V2_VERSION, date: dateIso, programs: [...V2_DEFAULT_PROGRAMS], items };
}
