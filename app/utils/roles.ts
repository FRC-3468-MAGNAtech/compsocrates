export const TEAM_ROLES = [
  "match-scout",
  "pit-scout",
  "pit-team",
  "drive-team",
  "lead-scout",
  "lead-strategist",
  "team-coach",
] as const;

export type TeamRole = (typeof TEAM_ROLES)[number];

export type RoleAwareUser = {
  role?: string;
  roles?: string[];
  uid?: string;
  isTeamAdmin?: boolean;
};

export type FormKey =
  | "match-scout-form"
  | "pit-scout-form"
  | "strategy-scout-form"
  | "drive-scout-form"
  | "helper-form";

export type FormAccessOverrides = Partial<Record<FormKey, string[]>>;

export const FORM_LABELS: Record<FormKey, string> = {
  "match-scout-form": "Match Scout Form",
  "pit-scout-form": "Pit Scout Form",
  "strategy-scout-form": "Strategy Scout Form",
  "drive-scout-form": "Drive Scout Form",
  "helper-form": "Helper Form",
};

export const FORM_ROLE_REQUIREMENT: Record<FormKey, TeamRole | null> = {
  "match-scout-form": null,
  "pit-scout-form": "pit-scout",
  "strategy-scout-form": "lead-strategist",
  "drive-scout-form": "drive-team",
  "helper-form": "pit-team",
};

export function normalizeLegacyRole(role: string | null | undefined): TeamRole {
  const safe = (role || "").trim().toLowerCase();
  if (TEAM_ROLES.includes(safe as TeamRole)) return safe as TeamRole;
  if (safe === "coach") return "team-coach";
  if (safe === "scout") return "match-scout";
  if (safe === "lead_scout") return "lead-scout";
  if (safe === "lead_strategist") return "lead-strategist";
  if (safe === "pit_scout") return "pit-scout";
  return "match-scout";
}

export function sanitizeRoles(inputRoles: unknown, fallbackRole?: string | null): TeamRole[] {
  const raw = Array.isArray(inputRoles) ? inputRoles : [];
  const mapped = raw
    .map((value) => normalizeLegacyRole(typeof value === "string" ? value : ""))
    .filter((value, index, arr) => arr.indexOf(value) === index);
  if (mapped.length > 0) return mapped;
  return [normalizeLegacyRole(fallbackRole)];
}

export function getPrimaryRole(roles: TeamRole[]): TeamRole {
  if (roles.includes("drive-team")) return "drive-team";
  return roles[0] || "match-scout";
}

export function getRoleLabel(role: TeamRole): string {
  if (role === "match-scout") return "Match Scout";
  if (role === "pit-scout") return "Pit Scout";
  if (role === "pit-team") return "Pit Team";
  if (role === "drive-team") return "Drive Team";
  if (role === "lead-scout") return "Lead Scout";
  if (role === "team-coach") return "Team Coach";
  return "Lead Strategist";
}

export function getUserRoles(user: RoleAwareUser | null | undefined): TeamRole[] {
  if (!user) return ["match-scout"];
  return sanitizeRoles(user.roles, user.role);
}

export function hasRole(user: RoleAwareUser | null | undefined, role: TeamRole): boolean {
  return getUserRoles(user).includes(role);
}

export function getRoleBadge(roleInput: string | null | undefined, rolesInput?: string[]) {
  const roles = sanitizeRoles(rolesInput, roleInput);
  const primaryRole = getPrimaryRole(roles);
  if (primaryRole === "drive-team") {
    return { bg: "bg-blue-100", text: "text-blue-800", label: "Drive Team" };
  }
  if (primaryRole === "pit-team") {
    return { bg: "bg-cyan-100", text: "text-cyan-800", label: "Pit Team" };
  }
  if (primaryRole === "pit-scout") {
    return { bg: "bg-indigo-100", text: "text-indigo-800", label: "Pit Scout" };
  }
  if (primaryRole === "lead-scout") {
    return { bg: "bg-purple-100", text: "text-purple-800", label: "Lead Scout" };
  }
  if (primaryRole === "lead-strategist") {
    return { bg: "bg-pink-100", text: "text-pink-800", label: "Lead Strategist" };
  }
  if (primaryRole === "team-coach") {
    return { bg: "bg-amber-100", text: "text-amber-800", label: "Team Coach" };
  }
  return { bg: "bg-emerald-100", text: "text-emerald-800", label: "Match Scout" };
}

export function normalizeFormAccessOverrides(input: unknown): FormAccessOverrides {
  const safe: FormAccessOverrides = {};
  if (!input || typeof input !== "object") return safe;
  for (const key of Object.keys(FORM_LABELS) as FormKey[]) {
    const value = (input as Record<string, unknown>)[key];
    if (!Array.isArray(value)) continue;
    safe[key] = value
      .map((id) => String(id || "").trim())
      .filter((id, index, arr) => id.length > 0 && arr.indexOf(id) === index);
  }
  return safe;
}

export function canAccessForm(params: {
  formKey: FormKey;
  user: RoleAwareUser | null | undefined;
  formAccessOverrides?: FormAccessOverrides;
}): boolean {
  const { formKey, user, formAccessOverrides } = params;
  if (!user?.uid) return false;
  if (user.isTeamAdmin) return true;
  if (getUserRoles(user).includes("team-coach")) return true;
  if (formKey === "match-scout-form") return true;
  const roles = getUserRoles(user);
  const requiredRole = FORM_ROLE_REQUIREMENT[formKey];
  if (requiredRole && roles.includes(requiredRole)) return true;
  const extraAllowed = formAccessOverrides?.[formKey] || [];
  return extraAllowed.includes(user.uid);
}
