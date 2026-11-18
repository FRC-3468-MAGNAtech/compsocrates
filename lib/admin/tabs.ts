import type { AdminTabId, ProgramAdmin } from "@/config/programs/types";

// The one resolver of the Admin Panel's tab list: the program's own list (`ProgramConfig.admin.tabs`), then who is looking. Pure.

/** Tabs only a platform owner sees. */
export const PLATFORM_TABS: readonly AdminTabId[] = ["applications", "templates", "recovery", "platform-changelog", "platform-credits", "verify-admins", "account-deletions"];

/** `accountDeletionEnabled`: the account deletion kill switch (the "Account deletions" tab exists only while it is ON; missing = OFF). */
/** `membershipsEnabled`: the memberships kill switch (the "Verify admins" tab exists only while it is ON; missing = OFF). */
/** `teamless`: the person has no team in this program (a platform owner opening the panel from the personal shell): only the platform tabs, which read no team data. */
export type AdminViewer = { isPlatformOwner: boolean; canManageForms: boolean; membershipsEnabled?: boolean; accountDeletionEnabled?: boolean; teamless?: boolean };

/** The tabs this program shows to this viewer, in the program's order. A tab the program does not list never appears. */
export function resolveAdminTabs(admin: ProgramAdmin, viewer: AdminViewer): AdminTabId[] {
  return admin.tabs.filter((tab) => (viewer.isPlatformOwner || !PLATFORM_TABS.includes(tab)) && (!viewer.teamless || PLATFORM_TABS.includes(tab)) && (tab !== "forms" || viewer.canManageForms) && (tab !== "verify-admins" || viewer.membershipsEnabled === true) && (tab !== "account-deletions" || viewer.accountDeletionEnabled === true));
}

/** The tab to open: the one asked for if it is shown, else the first shown (null when none). */
export function activeAdminTab(visible: readonly AdminTabId[], wanted: AdminTabId | null): AdminTabId | null {
  return wanted && visible.includes(wanted) ? wanted : (visible[0] ?? null);
}
