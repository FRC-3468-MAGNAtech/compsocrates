"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { getRoleBadge } from "@/app/utils/roles";

type TeamMember = {
  uid: string;
  displayName: string;
  email: string;
  role: string;
  roles?: string[];
  photoURL?: string;
};

function PeopleContent() {
  const { userData } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function loadMembers() {
      if (!userData?.teamId) return;
      const usersQuery = query(collection(db, "users"), where("teamId", "==", userData.teamId));
      const snapshot = await getDocs(usersQuery);
      const nextMembers = snapshot.docs
        .map((doc) => ({ uid: doc.id, ...doc.data() } as TeamMember))
        .filter((member) => {
          const visibility = (member as TeamMember & { profileVisibility?: "team" | "public" | "private" }).profileVisibility || "team";
          return visibility !== "private" || member.uid === userData.uid;
        });
      setMembers(nextMembers);
    }
    loadMembers();
  }, [userData?.teamId, userData?.uid]);

  const filteredMembers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return members;
    return members.filter((member) => {
      const badge = getRoleBadge(member.role, member.roles);
      return [
        member.displayName,
        member.email,
        member.role,
        badge.label,
        ...(member.roles || []),
      ].some((value) => String(value || "").toLowerCase().includes(term));
    });
  }, [members, search]);

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto p-8">
        <h1 className="text-3xl font-bold mb-2 theme-text">People</h1>
        <p className="text-gray-600 mb-6">View team member profiles.</p>
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <label className="block text-sm font-medium text-gray-700 mb-2">Search scouts and roles</label>
          <input
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 outline-none focus:border-red-400"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, email, or role"
          />
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredMembers.map((member) => {
            const badge = getRoleBadge(member.role, member.roles);
            const initials = member.displayName
              ?.split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((part) => part.charAt(0).toUpperCase())
              .join("") || "U";
            return (
            <Link
              key={member.uid}
              href={`/profile/${member.uid}`}
              className="bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-300"
            >
              <div className="flex items-center gap-3">
                {member.photoURL ? (
                  <img
                    src={member.photoURL}
                    alt={member.displayName}
                    className="w-12 h-12 rounded-full object-cover"
                    style={{ border: "2px solid rgba(var(--accent-rgb), 0.45)" }}
                  />
                ) : (
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center font-semibold"
                    style={{
                      backgroundColor: "rgba(var(--accent-rgb), 0.2)",
                      color: "var(--theme-body-text)",
                      border: "2px solid rgba(var(--accent-rgb), 0.5)",
                    }}
                  >
                    {initials}
                  </div>
                )}
                <div>
                  <p className="font-semibold">{member.displayName}</p>
                  <p className="text-sm text-gray-600">{member.email}</p>
                  <p className={`inline-block mt-1 px-2 py-0.5 rounded text-xs ${badge.bg} ${badge.text}`}>
                    {badge.label}
                  </p>
                </div>
              </div>
            </Link>
            );
          })}
          {filteredMembers.length === 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
              No team members match that search.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PeoplePage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <PeopleContent />
    </ProtectedRoute>
  );
}
