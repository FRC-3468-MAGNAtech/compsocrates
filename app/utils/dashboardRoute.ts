import { TeamRole, getPrimaryRole, sanitizeRoles } from "@/app/utils/roles";

type DashboardUser = {
  role?: string;
  roles?: string[];
  teamId?: string;
  preferredDashboard?: string;
};

function getRoleDashboard(role: TeamRole): string {
  if (role === "match-scout") return "/match-scout-dashboard";
  if (role === "pit-team") return "/pit-team-dashboard";
  if (role === "drive-team") return "/drive-team-dashboard";
  if (role === "pit-scout") return "/pit-scout-dashboard";
  if (role === "lead-scout") return "/lead-scout-dashboard";
  if (role === "lead-strategist") return "/lead-strategist-dashboard";
  if (role === "team-coach") return "/team-coach-dashboard";
  return "/match-scout-dashboard";
}

export function getDashboardRoute(user: DashboardUser | null | undefined): string {
  if (!user?.teamId) return "/dashboard";
  const preferred = String(user.preferredDashboard || "").trim();
  const allowed = new Set([
    "/match-scout-dashboard",
    "/pit-scout-dashboard",
    "/pit-team-dashboard",
    "/drive-team-dashboard",
    "/lead-scout-dashboard",
    "/lead-strategist-dashboard",
    "/team-coach-dashboard",
    "/coach-dashboard",
  ]);
  if (allowed.has(preferred)) return preferred;
  const roles = sanitizeRoles(user.roles, user.role);
  return getRoleDashboard(getPrimaryRole(roles));
}
