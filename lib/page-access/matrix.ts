import { explainAccess, rolesOf, type AccessUser, type PageAccessConfig } from "@/lib/page-access/access";
import type { AccessPageRow } from "@/lib/page-access/page-list";
import { getRole, type RoleId } from "@/lib/roles";

// Session 6: what one cell of the All Members matrix shows. Pure; every answer comes from `explainAccess`, never from a second rule.

export type CellState =
  /** A locked check: an always-on page. */
  | { kind: "always" }
  /** A grey check: access through a role (an admin's own access counts as role access), or an open page nobody closed. Not toggled here. */
  | { kind: "role"; roles: RoleId[]; admin?: boolean }
  | { kind: "open" }
  /** A solid check: granted to this member individually. Click removes it. */
  | { kind: "granted" }
  /** Blocked for this member (a per-member deny). */
  | { kind: "blocked"; roles: RoleId[] }
  /** No access. Click grants it. */
  | { kind: "none" };

export type CellKind = CellState["kind"];

export function cellState(member: AccessUser, row: AccessPageRow, config: PageAccessConfig): CellState {
  if (row.kind === "always") return { kind: "always" };
  const e = explainAccess(member, row.id, config);
  switch (e.source) {
    case "admin":
      return { kind: "role", roles: [], admin: true };
    case "open":
      return { kind: "open" };
    case "role":
      return { kind: "role", roles: e.viaRoles };
    case "grant":
      return { kind: "granted" };
    case "denied":
      return { kind: "blocked", roles: e.viaRoles };
    default:
      return { kind: "none" };
  }
}

/** What a screen reader hears: "Maria Lopez, Match List: granted by role Scout". */
export function cellLabel(memberName: string, pageTitle: string, state: CellState, adminOnly = false): string {
  const roles = (r: RoleId[]) => r.map((id) => getRole(id).label).join(", ");
  switch (state.kind) {
    case "always":
      return `${memberName}, ${pageTitle}: always available, locked`;
    case "role":
      return state.admin ? `${memberName}, ${pageTitle}: granted because they are an admin` : `${memberName}, ${pageTitle}: granted by role ${roles(state.roles)}`;
    case "open":
      return `${memberName}, ${pageTitle}: open to everyone by default`;
    case "granted":
      return `${memberName}, ${pageTitle}: granted to this member. Press to remove`;
    case "blocked":
      return `${memberName}, ${pageTitle}: blocked for this member. Press to explain`;
    default:
      return adminOnly ? `${memberName}, ${pageTitle}: no access, admins only` : `${memberName}, ${pageTitle}: no access. Press to grant`;
  }
}

/** The roles a member holds, primary first, as labels. */
export const roleLabelsOf = (member: Pick<AccessUser, "primaryRole" | "secondaryRoles">): string[] => rolesOf(member).map((r) => getRole(r).label);

/**
 * What a click does. `grant` / `remove` change the member's own override; `explain` only shows why (role and open cells are not toggled here);
 * `none` is a locked cell.
 */
export type CellAction = { type: "grant" } | { type: "remove" } | { type: "explain" } | { type: "none" };

export function cellAction(state: CellState, row: Pick<AccessPageRow, "kind">): CellAction {
  if (row.kind === "admin") return state.kind === "role" ? { type: "explain" } : { type: "none" };
  switch (state.kind) {
    case "none":
      return { type: "grant" };
    case "granted":
      return { type: "remove" };
    case "always":
      return { type: "none" };
    default:
      return { type: "explain" };
  }
}
