"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth, UserRole } from "@/app/AuthContext";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { getDashboardRoute } from "@/app/utils/dashboardRoute";

type ProtectedRouteProps = {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
  requireAuth?: boolean;
};

export default function ProtectedRoute({ 
  children, 
  allowedRoles,
  requireAuth = true 
}: ProtectedRouteProps) {
  const { user, userData, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

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
      const allowNoTeam = pathname === "/dashboard" || pathname === "/account" || pathname === "/verify-email";
      if (!allowNoTeam) {
        router.push("/dashboard");
        return;
      }
    }

    // If specific roles are required
    if (allowedRoles && userData && !allowedRoles.includes(userData.role)) {
      router.push(getDashboardRoute(userData));
      return;
    }
  }, [user, userData, loading, requireAuth, allowedRoles, router, pathname]);

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
  if (allowedRoles && userData && !allowedRoles.includes(userData.role)) return null;

  return <>{children}</>;
}
