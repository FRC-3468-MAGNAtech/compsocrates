"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth, UserRole } from "@/app/AuthContext";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { getDashboardRoute } from "@/app/utils/dashboardRoute";
import { canAccessForm, FormAccessOverrides, FormKey, getUserRoles, normalizeFormAccessOverrides } from "@/app/utils/roles";
import { db } from "@/app/firebase";
import { doc, getDoc } from "firebase/firestore";

type ProtectedRouteProps = {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
  requireAuth?: boolean;
  requireVersionReleaseAccess?: boolean;
  formKey?: FormKey;
};

export default function ProtectedRoute({ 
  children, 
  allowedRoles,
  requireAuth = true,
  requireVersionReleaseAccess = false,
  formKey,
}: ProtectedRouteProps) {
  const { user, userData, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [formAccessOverrides, setFormAccessOverrides] = useState<FormAccessOverrides>({});
  const [formAccessLoading, setFormAccessLoading] = useState(false);

  useEffect(() => {
    let isActive = true;
    if (!formKey || !userData?.teamId) {
      setFormAccessOverrides({});
      setFormAccessLoading(false);
      return () => {};
    }
    setFormAccessLoading(true);
    async function loadOverrides() {
      try {
        const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
        if (!isActive) return;
        if (teamDoc.exists()) {
          setFormAccessOverrides(normalizeFormAccessOverrides(teamDoc.data().formAccessOverrides));
        } else {
          setFormAccessOverrides({});
        }
      } catch (error) {
        console.error("Failed to load form access overrides:", error);
        if (isActive) setFormAccessOverrides({});
      } finally {
        if (isActive) setFormAccessLoading(false);
      }
    }
    void loadOverrides();
    return () => {
      isActive = false;
    };
  }, [formKey, userData?.teamId]);

  const hasFormOverrideAccess = useMemo((): boolean => {
    if (!formKey || !userData) return false;
    return canAccessForm({ formKey, user: userData, formAccessOverrides });
  }, [formKey, formAccessOverrides, userData]);

  const hasAllowedRole = useMemo((): boolean => {
    if (!allowedRoles || !userData) return true;
    if (userData.isTeamAdmin) return true;
    if (hasFormOverrideAccess) return true;
    const userRoles = getUserRoles(userData);
    const allowed = new Set<string>(allowedRoles);
    if (allowed.has(userData.role)) return true;
    for (const role of userRoles) {
      if (allowed.has(role)) return true;
    }
    if (allowed.has("scout") && userRoles.some((role) => role !== "lead-strategist")) return true;
    if (allowed.has("coach") && (userRoles.includes("lead-strategist") || userRoles.includes("team-coach") || userData.isTeamAdmin)) return true;
    return false;
  }, [allowedRoles, hasFormOverrideAccess, userData]);

  const hasRequiredVersionReleaseAccess = useMemo((): boolean => {
    if (!requireVersionReleaseAccess) return true;
    return Boolean(userData?.canManageVersionReleases);
  }, [requireVersionReleaseAccess, userData?.canManageVersionReleases]);

  useEffect(() => {
    if (loading || formAccessLoading) return;

    // If route requires auth but user is not logged in
    if (requireAuth && !user) {
      router.push("/login");
      return;
    }

    if (requireAuth && userData?.profileComplete === false && pathname !== "/signup") {
      router.push("/signup?google=1");
      return;
    }

    // If user is logged in but trying to access login/signup
    if (!requireAuth && user) {
      if (pathname === "/signup" && userData?.profileComplete === false) {
        return;
      }
      router.push(getDashboardRoute(userData));
      return;
    }

    // If user has no team, force no-team dashboard except allowed onboarding pages.
    if (requireAuth && user && userData && !userData.teamId) {
      const allowNoTeam =
        pathname === "/dashboard" ||
        pathname === "/account" ||
        pathname === "/verify-email" ||
        pathname === "/signup" ||
        pathname === "/changelog" ||
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
  }, [user, userData, loading, formAccessLoading, requireAuth, router, pathname, hasAllowedRole, hasRequiredVersionReleaseAccess]);

  // Show loading state
  if (loading || formAccessLoading) {
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
