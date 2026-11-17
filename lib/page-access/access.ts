import { NEVER_RESTRICTED_ROLES, PAGES, RESTRICTABLE_OPEN_PAGES, RESTRICTED_PAGES, getPage, isRestrictableOpenPage, type PageDef } from "@/lib/page-access/pages";
import { ROLES, type RoleId } from "@/lib/roles";

// P26: who can open a page. The ONE function behind the navigation, the route guard and the Admin Panel's preview;
// firestore.rules' `pageAccessAllowed(pageId, defaultRoles)` is its twin for gated writes (keep both in sync).

/** `teams/{teamId}/settings/pageAccess` (its read model; the stored doc also carries `pageRoles`, see `pageRolesOf`). */
export type PageAccessConfig = {
  /** Per role, the restricted pages that role can open. */
  roleGrants: Partial<Record<RoleId, string[]>>;
  /** Per member: extra pages they can open (`grant`) and pages that are closed to them whatever their role says (`deny`). */
  memberOverrides: Record<string, MemberOverride>;
  /**
   * Session 6, additive: per role, the OPEN pages that role is closed out of ("open to everyone by default" is the rule until an admin unticks a role).
   * Absent or empty means no restriction, which behaves exactly as before. Client-side only: rules never gated open pages.
   */
  openRestrictions?: Partial<Record<RoleId, string[]>>;
};

export type MemberOverride = { grant: string[]; deny: string[] };

/** What access needs to know about a person. An admin or the owner opens everything. */
export type AccessUser = { uid: string; isAdmin: boolean; isOwner?: boolean; primaryRole: RoleId; secondaryRoles: RoleId[] };

const ROLE_IDS = ROLES.map((r) => r.id);

/** The grants the registry's `defaultRoles` imply, for every role. */
export function defaultRoleGrants(): Record<RoleId, string[]> {
  const grants = {} as Record<RoleId, string[]>;
  for (const role of ROLE_IDS) grants[role] = RESTRICTED_PAGES.filter((p) => p.defaultRoles.includes(role)).map((p) => p.id);
  return grants;
}

export function defaultPageAccessConfig(): PageAccessConfig {
  return { roleGrants: defaultRoleGrants(), memberOverrides: {} };
}

function asIds(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Role ids that may carry an open-page restriction (never an admin or owner id). */
const RESTRICTABLE_ROLE_IDS = ROLE_IDS.filter((r) => !NEVER_RESTRICTED_ROLES.includes(r));

/** The most pages one role can have restricted (the number of restrictable open pages): the cap on what a doc may hold. */
export const MAX_OPEN_RESTRICTIONS_PER_ROLE = RESTRICTABLE_OPEN_PAGES.length;

/**
 * Cleans any `openRestrictions` value (stored or about to be saved): role ids as keys (never an admin or owner id), string-array values, page ids that are
 * restrictable OPEN pages only (never an always-on page or the Admin Panel), de-duplicated and capped. Empty roles are dropped. Never throws.
 */
export function sanitizeOpenRestrictions(raw: unknown): Partial<Record<RoleId, string[]>> {
  const out: Partial<Record<RoleId, string[]>> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const stored = raw as Record<string, unknown>;
  for (const role of RESTRICTABLE_ROLE_IDS) {
    const ids = [...new Set(asIds(stored[role]))].filter(isRestrictableOpenPage).slice(0, MAX_OPEN_RESTRICTIONS_PER_ROLE);
    if (ids.length > 0) out[role] = ids;
  }
  return out;
}

/**
 * Reads whatever is stored (or nothing) into a complete config. A missing doc is the defaults. A role missing from a
 * stored doc gets its default grants (so adding a role later never locks it out), and unknown page ids are dropped.
 */
export function parsePageAccess(raw: unknown): PageAccessConfig {
  const defaults = defaultRoleGrants();
  if (!raw || typeof raw !== "object") return defaultPageAccessConfig();
  const r = raw as Record<string, unknown>;
  const storedGrants = r.roleGrants && typeof r.roleGrants === "object" ? (r.roleGrants as Record<string, unknown>) : {};
  const restrictedIds = new Set(RESTRICTED_PAGES.map((p) => p.id));
  // A member grant can also re-open a restricted OPEN page for one person (Session 6); a deny stays for restricted pages only.
  const grantableIds = new Set([...restrictedIds, ...RESTRICTABLE_OPEN_PAGES.map((p) => p.id)]);
  const roleGrants = {} as Record<RoleId, string[]>;
  for (const role of ROLE_IDS) {
    roleGrants[role] = role in storedGrants ? [...new Set(asIds(storedGrants[role]))].filter((id) => restrictedIds.has(id)) : defaults[role];
  }
  const memberOverrides: Record<string, MemberOverride> = {};
  const storedOverrides = r.memberOverrides && typeof r.memberOverrides === "object" ? (r.memberOverrides as Record<string, unknown>) : {};
  for (const [uid, value] of Object.entries(storedOverrides)) {
    const o = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const grant = [...new Set(asIds(o.grant))].filter((id) => grantableIds.has(id));
    const deny = [...new Set(asIds(o.deny))].filter((id) => restrictedIds.has(id));
    if (grant.length > 0 || deny.length > 0) memberOverrides[uid] = { grant, deny };
  }
  const openRestrictions = sanitizeOpenRestrictions(r.openRestrictions);
  return Object.keys(openRestrictions).length > 0 ? { roleGrants, memberOverrides, openRestrictions } : { roleGrants, memberOverrides };
}

/** The roles of a person, primary first. */
export const rolesOf = (user: Pick<AccessUser, "primaryRole" | "secondaryRoles">): RoleId[] => [user.primaryRole, ...(user.secondaryRoles ?? [])];

export type AccessSource =
  /** An admin or the owner: always everything. */
  | "admin"
  | "open"
  /** One of the person's roles grants it. */
  | "role"
  /** An extra page granted to this member. */
  | "grant"
  /** Closed to this member by an explicit deny (even if a role or a grant would open it). */
  | "denied"
  /** No role and no grant. */
  | "none"
  /** Admin-only page, and this isn't an admin. */
  | "admin-only"
  /** An open page that every one of the person's roles has been closed out of (Session 6), and no individual grant re-opens it. */
  | "restricted";

export type AccessExplanation = { allowed: boolean; source: AccessSource; /** The roles that grant it (source "role"/"denied" when a role would have). */ viaRoles: RoleId[] };

/** `canAccessPage` with the reason, for the Admin Panel's "where this access comes from". */
export function explainAccess(user: AccessUser, pageId: string, config: PageAccessConfig | null | undefined): AccessExplanation {
  const page = getPage(pageId);
  if (!page) return { allowed: false, source: "none", viaRoles: [] };
  if (user.isAdmin || user.isOwner) return { allowed: true, source: "admin", viaRoles: [] };
  if (page.access === "open") {
    const closed = isRestrictableOpenPage(pageId) && rolesOf(user).every((role) => config?.openRestrictions?.[role]?.includes(pageId));
    if (!closed) return { allowed: true, source: "open", viaRoles: [] };
    if (config?.memberOverrides[user.uid]?.grant.includes(pageId)) return { allowed: true, source: "grant", viaRoles: [] };
    return { allowed: false, source: "restricted", viaRoles: [] };
  }
  if (page.access === "admin") return { allowed: false, source: "admin-only", viaRoles: [] };

  const cfg = config ?? defaultPageAccessConfig();
  const override = cfg.memberOverrides[user.uid];
  const viaRoles = rolesOf(user).filter((role) => (cfg.roleGrants[role] ?? defaultRoleGrants()[role] ?? []).includes(pageId));
  const granted = !!override?.grant.includes(pageId);
  if (override?.deny.includes(pageId)) return { allowed: false, source: "denied", viaRoles };
  if (viaRoles.length > 0) return { allowed: true, source: "role", viaRoles };
  if (granted) return { allowed: true, source: "grant", viaRoles };
  return { allowed: false, source: "none", viaRoles };
}

/**
 * Can this person open this page? Admin or owner: yes. An open page: yes. A restricted page: any of their roles (primary
 * or secondary) grants it, or they have an explicit grant, minus an explicit deny. An admin-only page: no. An unknown page: no.
 */
export function canAccessPage(user: AccessUser | null | undefined, pageId: string, config?: PageAccessConfig | null): boolean {
  if (!user) return false;
  return explainAccess(user, pageId, config).allowed;
}

// --- editing (pure; the Admin Panel applies these and writes the result) -------------------------------------------------------

/** Turns one role's access to one restricted page on or off. */
export function setRoleGrant(config: PageAccessConfig, role: RoleId, pageId: string, on: boolean): PageAccessConfig {
  if (!getPage(pageId) || getPage(pageId)!.access !== "restricted") return config;
  const current = config.roleGrants[role] ?? [];
  const next = on ? [...new Set([...current, pageId])] : current.filter((id) => id !== pageId);
  return { ...config, roleGrants: { ...config.roleGrants, [role]: next } };
}

/** Closes an open page to one role (`restricted` true) or re-opens it. Refuses what can never be closed: an always-on page, the Admin Panel, a restricted page, an admin or owner id. */
export function setOpenRestriction(config: PageAccessConfig, role: RoleId, pageId: string, restricted: boolean): PageAccessConfig {
  if (!isRestrictableOpenPage(pageId) || NEVER_RESTRICTED_ROLES.includes(role) || !ROLE_IDS.includes(role)) return config;
  const current = config.openRestrictions?.[role] ?? [];
  const next = restricted ? [...new Set([...current, pageId])] : current.filter((id) => id !== pageId);
  const openRestrictions = { ...config.openRestrictions };
  if (next.length > 0) openRestrictions[role] = next;
  else delete openRestrictions[role];
  const base: PageAccessConfig = { roleGrants: config.roleGrants, memberOverrides: config.memberOverrides };
  return Object.keys(openRestrictions).length > 0 ? { ...base, openRestrictions } : base;
}

/** How many pages beyond the always-on ones (and the Admin Panel) a role opens. 0 means the role reaches only the always-on pages: the screen warns, but allows it. */
export function rolePageCount(config: PageAccessConfig, role: RoleId): number {
  const restricted = RESTRICTED_PAGES.filter((p) => (config.roleGrants[role] ?? []).includes(p.id)).length;
  const open = RESTRICTABLE_OPEN_PAGES.filter((p) => !config.openRestrictions?.[role]?.includes(p.id)).length;
  return restricted + open;
}

export type MemberPageState = "default" | "grant" | "deny";

/** What a member's override says about one page. */
export function memberPageState(config: PageAccessConfig, uid: string, pageId: string): MemberPageState {
  const o = config.memberOverrides[uid];
  if (o?.deny.includes(pageId)) return "deny";
  if (o?.grant.includes(pageId)) return "grant";
  return "default";
}

/** Sets a member's override for one page: follow their roles (default), grant it, or deny it. An override that ends up empty is dropped. */
export function setMemberPageState(config: PageAccessConfig, uid: string, pageId: string, state: MemberPageState): PageAccessConfig {
  const page = getPage(pageId);
  if (!page) return config;
  // A restrictable OPEN page takes a grant (or "follow roles") only: there is no deny on an open page.
  if (page.access !== "restricted" && !(isRestrictableOpenPage(pageId) && state !== "deny")) return config;
  const current = config.memberOverrides[uid] ?? { grant: [], deny: [] };
  const grant = current.grant.filter((id) => id !== pageId);
  const deny = current.deny.filter((id) => id !== pageId);
  if (state === "grant") grant.push(pageId);
  if (state === "deny") deny.push(pageId);
  const memberOverrides = { ...config.memberOverrides };
  if (grant.length === 0 && deny.length === 0) delete memberOverrides[uid];
  else memberOverrides[uid] = { grant, deny };
  return { ...config, memberOverrides };
}

/** Approving an access request: the member gets the page as an explicit grant (and a deny on it is lifted). */
export const grantMemberPage = (config: PageAccessConfig, uid: string, pageId: string): PageAccessConfig => setMemberPageState(config, uid, pageId, "grant");

/**
 * The rules-friendly mirror stored beside `roleGrants`: for every restricted page, the roles that have it. Rules can't loop
 * over a map or a list, so `firestore.rules` asks "is one of my roles in `pageRoles[pageId]`" instead. Always complete.
 */
export function pageRolesOf(config: PageAccessConfig): Record<string, RoleId[]> {
  const out: Record<string, RoleId[]> = {};
  for (const page of RESTRICTED_PAGES) out[page.id] = ROLE_IDS.filter((role) => (config.roleGrants[role] ?? []).includes(page.id));
  return out;
}

/** True when the two configs say the same thing (order of ids doesn't matter). */
export function samePageAccess(a: PageAccessConfig, b: PageAccessConfig): boolean {
  const norm = (c: PageAccessConfig) =>
    JSON.stringify({
      g: ROLE_IDS.map((r) => [...(c.roleGrants[r] ?? [])].sort()),
      o: Object.keys(c.memberOverrides)
        .sort()
        .map((uid) => [uid, [...c.memberOverrides[uid].grant].sort(), [...c.memberOverrides[uid].deny].sort()]),
      r: ROLE_IDS.map((r) => [...(c.openRestrictions?.[r] ?? [])].sort()),
    });
  return norm(a) === norm(b);
}

/** Every page this person can open, in registry order (the Admin Panel's "Preview as member" and the nav). */
export function accessiblePages(user: AccessUser, config: PageAccessConfig | null | undefined): PageDef[] {
  return PAGES.filter((p) => canAccessPage(user, p.id, config));
}
