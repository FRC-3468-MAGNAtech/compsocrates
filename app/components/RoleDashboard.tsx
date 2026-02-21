"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { FORM_LABELS, FormAccessOverrides, TeamRole, canAccessForm, getRoleLabel, normalizeFormAccessOverrides } from "@/app/utils/roles";
import { db } from "@/app/firebase";
import { doc, getDoc } from "firebase/firestore";

type RoleDashboardProps = {
  role: TeamRole;
  title: string;
  description: string;
};

const formLinks = [
  { href: "/scout-form", key: "match-scout-form" as const },
  { href: "/pit-scout-form", key: "pit-scout-form" as const },
  { href: "/strategy-scout-form", key: "strategy-scout-form" as const },
  { href: "/drive-scout-form", key: "drive-scout-form" as const },
  { href: "/helper-form", key: "helper-form" as const },
];

export default function RoleDashboard({ role, title, description }: RoleDashboardProps) {
  const { userData } = useAuth();
  const [formAccessOverrides, setFormAccessOverrides] = useState<FormAccessOverrides>({});

  useEffect(() => {
    async function loadTeamAccess() {
      if (!userData?.teamId) return;
      const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
      setFormAccessOverrides(
        normalizeFormAccessOverrides(teamDoc.exists() ? teamDoc.data().formAccessOverrides : null)
      );
    }
    void loadTeamAccess();
  }, [userData?.teamId]);

  return (
    <ProtectedRoute requireAuth={true} allowedRoles={[role, "coach", "scout"]}>
      <div className="flex h-screen bg-gray-100">
        <Sidebar />
        <div className="flex-1 overflow-y-auto p-8">
          <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>
            {title}
          </h1>
          <p className="text-gray-600 mb-6">{description}</p>

          <div className="bg-white rounded-xl shadow-md p-6 mb-6">
            <h2 className="text-lg font-semibold mb-2">Your Active Role</h2>
            <p className="text-gray-700">{getRoleLabel(role)}</p>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6">
            <h2 className="text-lg font-semibold mb-4">Available Forms</h2>
            <div className="grid md:grid-cols-2 gap-3">
              {formLinks
                .filter((form) =>
                  canAccessForm({
                    formKey: form.key,
                    user: userData,
                    formAccessOverrides,
                  })
                )
                .map((form) => (
                  <Link
                    key={form.key}
                    href={form.href}
                    className="px-4 py-3 rounded-lg border hover:bg-gray-50 font-medium"
                  >
                    {FORM_LABELS[form.key]}
                  </Link>
                ))}
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
