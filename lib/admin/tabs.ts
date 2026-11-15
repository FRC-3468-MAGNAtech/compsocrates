import type { AdminTabId, ProgramAdmin } from "@/config/programs/types";

// The one resolver of the Admin Panel's tab list: the program's own list (`ProgramConfig.admin.tabs`), then who is looking. Pure.

/** Tabs only a platform owner sees. */
export const PLATFORM_TABS: readonly AdminTabId[] = ["applications", "templates", "recovery"];

export type AdminViewer = { isPlatformOwner: boolean; canManageForms: boolean };

/** The tabs this program shows to this viewer, in the program's order. A tab the program does not list never appears. */
export function resolveAdminTabs(admin: ProgramAdmin, viewer: AdminViewer): AdminTabId[] {
  return admin.tabs.filter((tab) => (viewer.isPlatformOwner || !PLATFORM_TABS.includes(tab)) && (tab !== "forms" || viewer.canManageForms));
}

/** The tab to open: the one asked for if it is shown, else the first shown (null when none). */
export function activeAdminTab(visible: readonly AdminTabId[], wanted: AdminTabId | null): AdminTabId | null {
  return wanted && visible.includes(wanted) ? wanted : (visible[0] ?? null);
}
