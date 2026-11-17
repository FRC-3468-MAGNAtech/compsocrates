// The sidebar config: how an admin arranges the pages the code defines (`lib/nav.ts`). The code decides WHICH pages exist; this only arranges them.
// Visibility here is cosmetic: hiding a page never blocks its route and showing one never grants access (page access and the rules stay where they are).

/** `parent` of a top-level entry in the main list. */
export const MAIN_ZONE = null;
/** `parent` of a top-level entry in the footer block (below the divider). */
export const FOOTER_ZONE = "@footer";

export const SIDEBAR_CONFIG_VERSION = 1;
export const MAX_SIDEBAR_ENTRIES = 120;
export const MAX_LABEL_LENGTH = 40;

/** The id of the group that holds the form pages by default. */
export const FORMS_GROUP_ID = "forms";
export const ADMIN_PAGE_ID = "admin-panel";

export type SidebarEntry = {
  /** A page id (`NavItem.id`) or a group id. Never a label. */
  id: string;
  kind: "page" | "group";
  /** `null` = main list, `"@footer"` = footer block, otherwise the id of a group (one nesting level). */
  parent: string | null;
  order: number;
  /** Replaces the default label. A group always has one. */
  label?: string;
  /** A key of `SIDEBAR_ICONS`. */
  icon?: string;
  hidden?: boolean;
};

export type SidebarConfig = {
  version: typeof SIDEBAR_CONFIG_VERSION;
  /** Counts saves; a save only lands if the stored `rev` is the one it was loaded with. */
  rev: number;
  entries: SidebarEntry[];
};
