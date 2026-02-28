"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/app/AuthContext";
import { useRouter } from "next/navigation";
import { updatePassword, updateEmail, EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import ThemePicker from "@/app/components/ThemePicker";
import { updateSecureUserDoc } from "@/app/utils/secureUserDoc";
import ProfilePictureUpload from "@/app/components/ProfilePictureUpload";
import { db } from "@/app/firebase";

function AccountContent() {
  const router = useRouter();
  const { user, userData, updateUserData, refreshUserData } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  
  const [passwords, setPasswords] = useState({
    current: "",
    new: "",
    confirm: "",
  });

  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [profileBio, setProfileBio] = useState(userData?.bio || "");
  const [profileVisibility, setProfileVisibility] = useState<"team" | "public" | "private">(userData?.profileVisibility || "team");
  const [teamDisplayLabel, setTeamDisplayLabel] = useState("");

  useEffect(() => {
    setProfileBio(userData?.bio || "");
    setProfileVisibility(userData?.profileVisibility || "team");
  }, [userData?.bio, userData?.profileVisibility]);

  useEffect(() => {
    async function loadTeamDisplayLabel() {
      if (!userData?.teamId) {
        setTeamDisplayLabel("");
        return;
      }
      try {
        const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
        if (teamDoc.exists()) {
          const data = teamDoc.data() as { teamNumber?: string; teamName?: string };
          const preferred = String(data.teamNumber || data.teamName || userData.teamId).trim();
          setTeamDisplayLabel(preferred || userData.teamId);
        } else {
          setTeamDisplayLabel(userData.teamId);
        }
      } catch (error) {
        console.error("Error loading team label:", error);
        setTeamDisplayLabel(userData.teamId);
      }
    }
    void loadTeamDisplayLabel();
  }, [userData?.teamId]);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      if (passwords.new !== passwords.confirm) {
        setError("New passwords do not match");
        setLoading(false);
        return;
      }

      if (passwords.new.length < 6) {
        setError("Password must be at least 6 characters");
        setLoading(false);
        return;
      }

      if (!user || !user.email) {
        setError("User not found");
        setLoading(false);
        return;
      }

      // Reauthenticate user
      const credential = EmailAuthProvider.credential(user.email, passwords.current);
      await reauthenticateWithCredential(user, credential);

      // Update password
      await updatePassword(user, passwords.new);

      setSuccess("Password updated successfully!");
      setPasswords({ current: "", new: "", confirm: "" });
    } catch (err: unknown) {
      console.error("Password update error:", err);
      const code = (err as { code?: string })?.code;
      const message = (err as { message?: string })?.message;
      if (code === "auth/wrong-password") {
        setError("Current password is incorrect");
      } else {
        setError(message || "Failed to update password");
      }
    }

    setLoading(false);
  }

  async function handleChangeEmail(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      if (!user || !user.email) {
        setError("User not found");
        setLoading(false);
        return;
      }

      // Reauthenticate user
      const credential = EmailAuthProvider.credential(user.email, emailPassword);
      await reauthenticateWithCredential(user, credential);

      // Update email in Firebase Auth
      await updateEmail(user, newEmail);

      // Update email in Firestore
      await updateSecureUserDoc(user.uid, {
        email: newEmail,
      });

      setSuccess("Email updated successfully!");
      setNewEmail("");
      setEmailPassword("");
    } catch (err: unknown) {
      console.error("Email update error:", err);
      const code = (err as { code?: string })?.code;
      const message = (err as { message?: string })?.message;
      if (code === "auth/wrong-password") {
        setError("Password is incorrect");
      } else if (code === "auth/email-already-in-use") {
        setError("This email is already in use");
      } else {
        setError(message || "Failed to update email");
      }
    }

    setLoading(false);
  }

  const displayName = userData?.displayName || user?.displayName || "User";
  const displayEmail = userData?.email || user?.email || "";
  const displayRoleRaw = userData
    ? (userData.roles && userData.roles.length ? userData.roles.join(", ") : userData.role)
    : "match-scout";
  const displayRole = String(displayRoleRaw).replace(/-/g, " ");
  const hasUserDoc = Boolean(userData);

  async function handleSaveProfilePreferences() {
    if (!user?.uid || !hasUserDoc) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      await updateUserData({
        bio: profileBio.trim(),
        profileVisibility,
      });
      await refreshUserData();
      setSuccess("Profile settings updated.");
    } catch (err) {
      console.error("Profile preference update error:", err);
      setError("Failed to update profile settings.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLeaveTeam() {
    if (!user?.uid || !userData?.teamId) return;
    if (!confirm("Leave this team? You will need to request access again to rejoin.")) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      await updateSecureUserDoc(user.uid, {
        teamId: "",
        role: "match-scout",
        roles: ["match-scout"],
        specialRoles: [],
        specialRole: null,
        isTeamAdmin: false,
      });
      await refreshUserData();
      setSuccess("You left the team.");
      router.push("/dashboard");
    } catch (err) {
      console.error("Leave team error:", err);
      setError("Failed to leave team.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-gray-100">
      <Sidebar />
      
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-4 sm:p-6 md:p-8">
          <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>
            Account Settings
          </h1>
          <p className="text-gray-600 mb-8">Manage your account information and security</p>
          {!userData?.teamId && (
            <div className="mb-6">
              <button
                onClick={() => router.push("/dashboard")}
                className="px-4 py-2 rounded text-white font-semibold"
                style={{ backgroundColor: "var(--primary-color)" }}
              >
                Back To Dashboard
              </button>
            </div>
          )}

          {/* SUCCESS/ERROR MESSAGES */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}
          {success && (
            <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-600">{success}</p>
            </div>
          )}

          {/* ACCOUNT INFO */}
          <div className="bg-white rounded-xl shadow p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Account Information</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name
                </label>
                <p className="text-gray-900">{displayName}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <p className="text-gray-900">{displayEmail || "Unknown"}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Role
                </label>
                <p className="text-gray-900 capitalize">{displayRole}</p>
              </div>

              <div>
                {Boolean(userData?.isTeamAdmin) && (
                  <p className="text-xs text-gray-500 mt-1">You are the team admin</p>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Profile Picture</h2>
            <ProfilePictureUpload />
          </div>

          {userData?.teamId && (
            <div className="bg-white rounded-xl shadow p-6 mb-6">
              <h2 className="text-xl font-semibold mb-2">Team Membership</h2>
              <p className="text-sm text-gray-600 mb-4">
                You are currently on Team <span className="font-semibold">{teamDisplayLabel || userData?.teamId}</span>.
              </p>
              <button
                type="button"
                onClick={handleLeaveTeam}
                disabled={loading}
                className="px-4 py-2 rounded border border-red-300 text-red-700 hover:bg-red-50 text-sm font-semibold disabled:opacity-50"
              >
                Leave Team
              </button>
            </div>
          )}

          <div className="bg-white rounded-xl shadow p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Profile Preferences</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Profile Visibility</label>
                <select
                  value={profileVisibility}
                  onChange={(event) => setProfileVisibility(event.target.value as "team" | "public" | "private")}
                  className="w-full border rounded-lg p-3"
                >
                  <option value="team">Team Only</option>
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Team only shows your profile to teammates. Private hides it from other users.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bio</label>
                <textarea
                  value={profileBio}
                  onChange={(event) => setProfileBio(event.target.value)}
                  className="w-full border rounded-lg p-3 h-24"
                  placeholder="Short bio for your profile"
                />
              </div>
              <button
                type="button"
                onClick={handleSaveProfilePreferences}
                disabled={loading || !hasUserDoc}
                className="px-6 py-2 rounded-lg text-white font-semibold disabled:opacity-50"
                style={{ backgroundColor: "var(--primary-color)" }}
              >
                Save Profile Preferences
              </button>
              {!hasUserDoc && (
                <p className="text-xs text-red-600">
                  Your profile document could not be loaded, so profile preference updates are temporarily disabled.
                </p>
              )}
            </div>
          </div>

          {/* THEMES */}
          <div className="bg-white rounded-xl shadow p-6 mb-6">
            <h2 className="text-xl font-semibold mb-2">Appearance</h2>
            <p className="text-sm text-gray-600 mb-4">Pick a light, dark, or pride theme.</p>
            <ThemePicker />
          </div>

          {/* CHANGE EMAIL */}
          <div className="bg-white rounded-xl shadow p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Change Email</h2>
            
            <form onSubmit={handleChangeEmail} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  New Email Address
                </label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full border rounded-lg p-3"
                  placeholder="newemail@example.com"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Current Password
                </label>
                <input
                  type="password"
                  value={emailPassword}
                  onChange={(e) => setEmailPassword(e.target.value)}
                  className="w-full border rounded-lg p-3"
                  placeholder="Enter your password to confirm"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2 rounded-lg text-white font-semibold disabled:opacity-50"
                style={{ backgroundColor: "var(--primary-color)" }}
              >
                {loading ? "Updating..." : "Update Email"}
              </button>
            </form>
          </div>

          {/* CHANGE PASSWORD */}
          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Change Password</h2>
            
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Current Password
                </label>
                <input
                  type="password"
                  value={passwords.current}
                  onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
                  className="w-full border rounded-lg p-3"
                  placeholder="Enter current password"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  New Password
                </label>
                <input
                  type="password"
                  value={passwords.new}
                  onChange={(e) => setPasswords({ ...passwords, new: e.target.value })}
                  className="w-full border rounded-lg p-3"
                  placeholder="At least 6 characters"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  value={passwords.confirm}
                  onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
                  className="w-full border rounded-lg p-3"
                  placeholder="Re-enter new password"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2 rounded-lg text-white font-semibold disabled:opacity-50"
                style={{ backgroundColor: "var(--primary-color)" }}
              >
                {loading ? "Updating..." : "Update Password"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AccountPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <AccountContent />
    </ProtectedRoute>
  );
}

