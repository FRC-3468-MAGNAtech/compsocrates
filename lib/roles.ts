export type RoleId =
  | "match-scout"
  | "pit-scout"
  | "pit-team"
  | "drive-team"
  | "lead-scout"
  | "lead-strategist"
  | "team-coach"
  | "media"
  | "judge-awards";

export type Role = {
  id: RoleId;
  label: string;
  /** Pill classes — same bg/text/border convention as components/ui/badge.tsx. */
  className: string;
};

// Fixed, distinct hues per role (not derived from the active theme's single
// accent) — the original themes (team red/gold, CompSocrates red) are warm,
// so role colors need to read as distinct from the theme *and* from each
// other, not a tint of it.
export const ROLES: Role[] = [
  { id: "match-scout", label: "Match Scout", className: "bg-sky-500/15 text-sky-300 border border-sky-400/30" },
  { id: "pit-scout", label: "Pit Scout", className: "bg-violet-500/15 text-violet-300 border border-violet-400/30" },
  { id: "pit-team", label: "Pit Team", className: "bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-400/30" },
  { id: "drive-team", label: "Drive Team", className: "bg-emerald-500/15 text-emerald-300 border border-emerald-400/30" },
  { id: "lead-scout", label: "Lead Scout", className: "bg-amber-500/15 text-amber-300 border border-amber-400/30" },
  {
    id: "lead-strategist",
    label: "Lead Strategist",
    className: "bg-orange-500/15 text-orange-300 border border-orange-400/30",
  },
  { id: "team-coach", label: "Team Coach", className: "bg-cyan-500/15 text-cyan-300 border border-cyan-400/30" },
  { id: "media", label: "Media", className: "bg-pink-500/15 text-pink-300 border border-pink-400/30" },
  { id: "judge-awards", label: "Judge Awards", className: "bg-lime-500/15 text-lime-300 border border-lime-400/30" },
];

export const DEFAULT_ROLE_ID: RoleId = "match-scout";

export function getRole(id: string): Role {
  return ROLES.find((r) => r.id === id) ?? ROLES[0];
}

const ROLE_IDS: readonly string[] = ROLES.map((r) => r.id);

/** True for one of the nine canonical role ids. */
export function isRoleId(value: unknown): value is RoleId {
  return typeof value === "string" && ROLE_IDS.includes(value);
}

/**
 * CS `normalizeLegacyRole` (app/utils/roles.ts): the nine canonical ids pass through; the legacy values CS data still
 * holds (`coach`, `scout`, `lead_scout`, `lead_strategist`, `pit_scout`, `judge_awards`) map to their canonical id;
 * anything else is a Match Scout.
 */
export function normalizeLegacyRole(role: string | null | undefined): RoleId {
  const safe = (role || "").trim().toLowerCase();
  if (isRoleId(safe)) return safe;
  if (safe === "coach") return "team-coach";
  if (safe === "scout") return "match-scout";
  if (safe === "lead_scout") return "lead-scout";
  if (safe === "lead_strategist") return "lead-strategist";
  if (safe === "pit_scout") return "pit-scout";
  if (safe === "judge_awards" || safe === "judgeawards") return "judge-awards";
  return "match-scout";
}

/** Roles in canonical order (the order of `ROLES`), de-duplicated. */
export function sortRolesCanonical(roles: Iterable<RoleId>): RoleId[] {
  const set = new Set(roles);
  return ROLES.map((r) => r.id).filter((id) => set.has(id));
}
