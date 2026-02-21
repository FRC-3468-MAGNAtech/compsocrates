import { TeamRole, getPrimaryRole, sanitizeRoles } from "@/app/utils/roles";

type DashboardUser = {
  role?: string;
  roles?: string[];
  teamId?: string;
};

function getRoleDashboard(role: TeamRole): string {
  if (role === "match-scout") return "/scout-dashboard";
  if (role === "pit-team") return "/pit-team-dashboard";
  if (role === "drive-team") return "/drive-team-dashboard";
  if (role === "pit-scout") return "/pit-scout-dashboard";
  if (role === "lead-scout") return "/lead-scout-dashboard";
  if (role === "lead-strategist") return "/lead-strategist-dashboard";
  if (role === "team-coach") return "/team-coach-dashboard";
  return "/scout-dashboard";
}

export function getDashboardRoute(user: DashboardUser | null | undefined): string {
  if (!user?.teamId) return "/dashboard";
  const roles = sanitizeRoles(user.roles, user.role);
  return getRoleDashboard(getPrimaryRole(roles));
}
