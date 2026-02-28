"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth, UserRole } from "@/app/AuthContext";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { getDashboardRoute } from "@/app/utils/dashboardRoute";
import { getUserRoles } from "@/app/utils/roles";
import { useMemo } from "react";

type ProtectedRouteProps = {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
  requireAuth?: boolean;
  requireVersionReleaseAccess?: boolean;
};

export default function ProtectedRoute({ 
  children, 
  allowedRoles,
  requireAuth = true,
  requireVersionReleaseAccess = false,
}: ProtectedRouteProps) {
  const { user, userData, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const hasAllowedRole = useMemo((): boolean => {
    if (!allowedRoles || !userData) return true;
    if (userData.isTeamAdmin) return true;
    const userRoles = getUserRoles(userData);
    const allowed = new Set<string>(allowedRoles);
    if (allowed.has(userData.role)) return true;
    for (const role of userRoles) {
      if (allowed.has(role)) return true;
    }
    if (allowed.has("scout") && userRoles.some((role) => role !== "lead-strategist")) return true;
    if (allowed.has("coach") && (userRoles.includes("lead-strategist") || userRoles.includes("team-coach") || userData.isTeamAdmin)) return true;
    return false;
  }, [allowedRoles, userData]);

  const hasRequiredVersionReleaseAccess = useMemo((): boolean => {
    if (!requireVersionReleaseAccess) return true;
    return Boolean(userData?.canManageVersionReleases);
  }, [requireVersionReleaseAccess, userData?.canManageVersionReleases]);

  useEffect(() => {
    if (loading) return;

    // If route requires auth but user is not logged in
    if (requireAuth && !user) {
      router.push("/login");
      return;
    }

    // If user is logged in but trying to access login/signup
    if (!requireAuth && user) {
      router.push(getDashboardRoute(userData));
      return;
    }

    // If user has no team, force no-team dashboard except allowed onboarding pages.
    if (requireAuth && user && userData && !userData.teamId) {
      const allowNoTeam =
        pathname === "/dashboard" ||
        pathname === "/account" ||
        pathname === "/verify-email" ||
        pathname === "/update-lot" ||
        pathname === "/version-releases";
      if (!allowNoTeam) {
        router.push("/dashboard");
        return;
      }
    }

    // If specific roles are required
    if (!hasAllowedRole) {
      router.push(getDashboardRoute(userData));
      return;
    }

    if (!hasRequiredVersionReleaseAccess) {
      router.push(getDashboardRoute(userData));
      return;
    }
  }, [user, userData, loading, requireAuth, router, pathname, hasAllowedRole, hasRequiredVersionReleaseAccess]);

  // Show loading state
  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: "var(--theme-page-canvas)", color: "var(--theme-body-text)" }}
      >
        <LoadingSpinner message="Loading..." />
      </div>
    );
  }

  // Don't render children if access is denied
  if (requireAuth && !user) return null;
  if (!requireAuth && user) return null;
  if (!hasAllowedRole) return null;
  if (!hasRequiredVersionReleaseAccess) return null;

  return <>{children}</>;
}
