"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth, UserRole } from "@/app/AuthContext";
import LoadingSpinner from "@/app/components/LoadingSpinner";

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

  useEffect(() => {
    if (loading) return;

    // If route requires auth but user is not logged in
    if (requireAuth && !user) {
      router.push("/login");
      return;
    }

    // If user is logged in but trying to access login/signup
    if (!requireAuth && user) {
      // Redirect to appropriate dashboard
      if (userData?.role === "coach") {
        router.push("/coach-dashboard");
      } else {
        router.push("/scout-dashboard");
      }
      return;
    }

    // If specific roles are required
    if (allowedRoles && userData && !allowedRoles.includes(userData.role)) {
      // Redirect to their appropriate dashboard
      if (userData.role === "coach") {
        router.push("/coach-dashboard");
      } else {
        router.push("/scout-dashboard");
      }
      return;
    }
  }, [user, userData, loading, requireAuth, allowedRoles, router]);

  // Show loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
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
