type DashboardUser = {
  role?: "coach" | "scout";
  teamId?: string;
};

export function getDashboardRoute(user: DashboardUser | null | undefined): string {
  if (!user?.teamId) return "/dashboard";
  return user.role === "coach" ? "/coach-dashboard" : "/scout-dashboard";
}
