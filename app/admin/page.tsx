"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { db } from "@/app/firebase";

type OwnerManagedUser = {
  uid: string;
  email: string;
  displayName: string;
  teamId?: string;
  role?: string;
  emailVerificationExempt?: boolean;
};

function AdminPanelContent() {
  const { userData } = useAuth();
  const [savingDashboard, setSavingDashboard] = useState(false);
  const [ownerAllowed, setOwnerAllowed] = useState(false);
  const [ownerLoading, setOwnerLoading] = useState(true);
  const [lookupValue, setLookupValue] = useState("");
  const [lookupMode, setLookupMode] = useState<"uid" | "email">("uid");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [managedUser, setManagedUser] = useState<OwnerManagedUser | null>(null);
  const [ownerDraftName, setOwnerDraftName] = useState("");
  const [ownerSaving, setOwnerSaving] = useState(false);
  const dashboardOptions = [
    { label: "Match Scout", value: "/match-scout-dashboard" },
    { label: "Pit Scout", value: "/pit-scout-dashboard" },
    { label: "Pit Team", value: "/pit-team-dashboard" },
    { label: "Drive Team", value: "/drive-team-dashboard" },
    { label: "Lead Scout", value: "/lead-scout-dashboard" },
    { label: "Lead Strategist", value: "/lead-strategist-dashboard" },
    { label: "Media", value: "/media-dashboard" },
    { label: "Judge Awards", value: "/judge-awards-dashboard" },
    { label: "Team Coach", value: "/team-coach-dashboard" },
  ];

  useEffect(() => {
    async function loadOwnerAccess() {
      if (!userData?.uid) {
        setOwnerAllowed(false);
        setOwnerLoading(false);
        return;
      }
      try {
        const response = await fetch("/api/owner/release-access", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uid: userData.uid, email: userData.email || "" }),
        });
        const payload = (await response.json()) as { allowed?: boolean };
        setOwnerAllowed(Boolean(payload.allowed));
      } catch {
        setOwnerAllowed(false);
      } finally {
        setOwnerLoading(false);
      }
    }
    void loadOwnerAccess();
  }, [userData?.uid, userData?.email]);

  async function savePreferredDashboard(nextValue: string) {
    if (!userData?.uid) return;
    setSavingDashboard(true);
    try {
      await setDoc(doc(db, "users", userData.uid), { preferredDashboard: nextValue }, { merge: true });
      alert("Default dashboard updated.");
    } catch (error) {
      console.error("Failed to save preferred dashboard:", error);
      alert("Unable to save default dashboard.");
    } finally {
      setSavingDashboard(false);
    }
  }

  async function lookupUserForOwner() {
    const value = lookupValue.trim();
    if (!ownerAllowed || !value) return;
    setLookupLoading(true);
    try {
      let result: OwnerManagedUser | null = null;
      if (lookupMode === "uid") {
        const snap = await getDoc(doc(db, "users", value));
        if (snap.exists()) {
          const row = snap.data() as Record<string, unknown>;
          result = {
            uid: snap.id,
            email: String(row.email || ""),
            displayName: String(row.displayName || ""),
            role: String(row.role || ""),
            teamId: String(row.teamId || ""),
            emailVerificationExempt: Boolean(row.emailVerificationExempt),
          };
        }
      } else {
        const snap = await getDocs(query(collection(db, "users"), where("email", "==", value)));
        if (!snap.empty) {
          const first = snap.docs[0];
          const row = first.data() as Record<string, unknown>;
          result = {
            uid: first.id,
            email: String(row.email || ""),
            displayName: String(row.displayName || ""),
            role: String(row.role || ""),
            teamId: String(row.teamId || ""),
            emailVerificationExempt: Boolean(row.emailVerificationExempt),
          };
        }
      }
      setManagedUser(result);
      setOwnerDraftName(result?.displayName || "");
      if (!result) alert("No user found for this lookup.");
    } catch (error) {
      console.error("Owner lookup failed:", error);
      alert("Lookup failed.");
    } finally {
      setLookupLoading(false);
    }
  }

  async function saveOwnerUserEdits() {
    if (!ownerAllowed || !managedUser) return;
    const nextDisplayName = ownerDraftName.trim();
    if (!nextDisplayName) {
      alert("Display name cannot be empty.");
      return;
    }
    setOwnerSaving(true);
    try {
      await updateDoc(doc(db, "users", managedUser.uid), {
        displayName: nextDisplayName,
        emailVerificationExempt: Boolean(managedUser.emailVerificationExempt),
        updatedAt: Date.now(),
      });
      setManagedUser((prev) => (prev ? { ...prev, displayName: nextDisplayName } : prev));
      alert("Owner update saved.");
    } catch (error) {
      console.error("Owner update failed:", error);
      alert("Unable to save owner update.");
    } finally {
      setOwnerSaving(false);
    }
  }

  if (ownerLoading) {
    return (
      <div className="flex h-screen bg-gray-50">
        <Sidebar />
        <div className="flex-1 overflow-auto p-8">
          <div className="max-w-xl bg-white rounded-xl shadow-md p-6">
            <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>Admin Panel</h1>
            <p className="text-gray-600">Checking access...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!userData?.isTeamAdmin && !ownerAllowed) {
    return (
      <div className="flex h-screen bg-gray-50">
        <Sidebar />
        <div className="flex-1 overflow-auto p-8">
          <div className="max-w-xl bg-white rounded-xl shadow-md p-6">
            <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>Admin Panel</h1>
            <p className="text-gray-600">Only team admins can access this panel.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>Admin Panel</h1>
          <p className="text-gray-600 mb-8">Search Firestore IDs for scouting and practice session records.</p>

          <div className="bg-white rounded-xl shadow-md p-6 border mb-4">
            <h2 className="text-xl font-semibold mb-2">Default Dashboard</h2>
            <p className="text-sm text-gray-600 mb-3">Set where your Dashboard button sends you by default.</p>
            <select
              className="w-full max-w-md border rounded p-2"
              value={String(userData?.preferredDashboard || "")}
              onChange={(event) => void savePreferredDashboard(event.target.value)}
              disabled={savingDashboard}
            >
              <option value="">Role-Based Default</option>
              {dashboardOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Link href="/admin/match-scout-ids" className="bg-white rounded-xl shadow-md p-6 border hover:bg-gray-50">
              <h2 className="text-xl font-semibold mb-2">Match Scout IDs</h2>
              <p className="text-sm text-gray-600">Search scouting document IDs for official match scouting rows.</p>
            </Link>
            <Link href="/admin/practice-session-ids" className="bg-white rounded-xl shadow-md p-6 border hover:bg-gray-50">
              <h2 className="text-xl font-semibold mb-2">Practice Session IDs</h2>
              <p className="text-sm text-gray-600">Search practice session document IDs for team members.</p>
            </Link>
          </div>

          {!ownerLoading && ownerAllowed && (
            <div className="bg-white rounded-xl shadow-md p-6 border mt-6">
              <h2 className="text-xl font-semibold mb-2">Owner User Management</h2>
              <p className="text-sm text-gray-600 mb-4">Lookup by UID/email, rename user, and manage email verification exemption.</p>

              <div className="grid md:grid-cols-[120px_1fr_auto] gap-2 mb-4">
                <select
                  className="border rounded p-2"
                  value={lookupMode}
                  onChange={(event) => setLookupMode(event.target.value === "email" ? "email" : "uid")}
                >
                  <option value="uid">UID</option>
                  <option value="email">Email</option>
                </select>
                <input
                  className="border rounded p-2"
                  value={lookupValue}
                  onChange={(event) => setLookupValue(event.target.value)}
                  placeholder={lookupMode === "uid" ? "Paste user UID" : "user@email.com"}
                />
                <button
                  type="button"
                  onClick={() => void lookupUserForOwner()}
                  disabled={lookupLoading}
                  className="px-4 py-2 rounded text-white font-semibold disabled:opacity-60"
                  style={{ backgroundColor: "var(--primary-color)" }}
                >
                  {lookupLoading ? "Searching..." : "Lookup"}
                </button>
              </div>

              {managedUser && (
                <div className="space-y-3 border rounded p-4">
                  <p className="text-sm text-gray-600">UID: <span className="font-mono text-gray-900">{managedUser.uid}</span></p>
                  <p className="text-sm text-gray-600">Email: <span className="text-gray-900">{managedUser.email || "-"}</span></p>
                  <p className="text-sm text-gray-600">Team: <span className="text-gray-900">{managedUser.teamId || "-"}</span></p>
                  <p className="text-sm text-gray-600">Role: <span className="text-gray-900">{managedUser.role || "-"}</span></p>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
                    <input
                      className="w-full border rounded p-2"
                      value={ownerDraftName}
                      onChange={(event) => setOwnerDraftName(event.target.value)}
                    />
                  </div>

                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={Boolean(managedUser.emailVerificationExempt)}
                      onChange={(event) =>
                        setManagedUser((prev) =>
                          prev ? { ...prev, emailVerificationExempt: event.target.checked } : prev
                        )
                      }
                    />
                    Email verification exempt (personally verified by owner)
                  </label>

                  <button
                    type="button"
                    onClick={() => void saveOwnerUserEdits()}
                    disabled={ownerSaving}
                    className="px-4 py-2 rounded text-white font-semibold disabled:opacity-60"
                    style={{ backgroundColor: "var(--primary-color)" }}
                  >
                    {ownerSaving ? "Saving..." : "Save Owner Changes"}
                  </button>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

export default function AdminPanelPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach", "scout"]}>
      <AdminPanelContent />
    </ProtectedRoute>
  );
}


