"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/app/AuthContext";
import { useRouter } from "next/navigation";
import { updatePassword, updateEmail, EmailAuthProvider, reauthenticateWithCredential, deleteUser, linkWithRedirect, GoogleAuthProvider, getRedirectResult } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { updateSecureUserDoc } from "@/app/utils/secureUserDoc";
import ProfilePictureUpload from "@/app/components/ProfilePictureUpload";
import { auth, db } from "@/app/firebase";
import { clearCookieConsent, readCookieConsent, writeCookieConsent, type CookieConsentValue } from "@/app/utils/cookieConsent";

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
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [cookieConsent, setCookieConsent] = useState<CookieConsentValue | null>(null);

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

  useEffect(() => {
    setCookieConsent(readCookieConsent());
    function onConsentChanged() {
      setCookieConsent(readCookieConsent());
    }
    window.addEventListener("cookie-consent-changed", onConsentChanged as EventListener);
    return () => window.removeEventListener("cookie-consent-changed", onConsentChanged as EventListener);
  }, []);

  useEffect(() => {
    if (!user) return;
    getRedirectResult(auth)
      .then(async (result) => {
        if (!result) return;
        await refreshUserData();
        setSuccess("Google account linked.");
      })
      .catch((err) => {
        console.error("Google redirect link error:", err);
        setError("Failed to link Google account.");
      });
  }, [user, refreshUserData]);

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
  const displayRoleRaw = userData?.role || "match-scout";
  const displayRole = String(displayRoleRaw).replace(/-/g, " ");
  const hasUserDoc = Boolean(userData);
  const hasGoogleProvider = Boolean(user?.providerData?.some((provider) => provider.providerId === "google.com"));

  async function handleLinkGoogle() {
    if (!user) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await linkWithRedirect(user, provider);
      return;
    } catch (err: unknown) {
      console.error("Link Google error:", err);
      const code = (err as { code?: string })?.code;
      if (code === "auth/provider-already-linked") {
        setSuccess("Google account already linked.");
      } else if (code === "auth/credential-already-in-use") {
        setError("That Google account is already linked to another user.");
      } else {
        setError("Failed to link Google account.");
      }
    } finally {
      setLoading(false);
    }
  }

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

  async function handleDeleteAccount() {
    if (!user?.uid) return;
    if (deleteConfirmText.trim().toUpperCase() !== "DELETE") {
      setError('Type "DELETE" to confirm account deletion.');
      setSuccess("");
      return;
    }
    if (!confirm("Delete your account permanently? This cannot be undone.")) return;

    setDeletingAccount(true);
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const idToken = await user.getIdToken();
      const cleanupResponse = await fetch("/api/user/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ uid: user.uid }),
      });
      if (!cleanupResponse.ok) {
        const payload = (await cleanupResponse.json().catch(() => ({}))) as { error?: string };
        throw new Error(String(payload.error || "Unable to remove account data."));
      }
      await deleteUser(user);
      router.push("/signup");
    } catch (err: unknown) {
      console.error("Delete account error:", err);
      const code = (err as { code?: string })?.code || "";
      const message = (err as { message?: string })?.message || "";
      if (code === "auth/requires-recent-login") {
        setError("For security, please log out and log back in, then delete your account again.");
      } else {
        setError(message || "Failed to delete account.");
      }
    } finally {
      setDeletingAccount(false);
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
            <h2 className="text-xl font-semibold mb-4">Linked Sign-In Methods</h2>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-sm text-gray-700">Google</p>
                <p className="text-xs text-gray-500">{hasGoogleProvider ? "Linked" : "Not linked"}</p>
              </div>
              <button
                type="button"
                onClick={handleLinkGoogle}
                disabled={loading || hasGoogleProvider || !auth.currentUser}
                className="px-4 py-2 rounded border text-sm font-semibold disabled:opacity-50"
                style={hasGoogleProvider ? { borderColor: "#cbd5f5", color: "#64748b" } : { borderColor: "var(--primary-color)", color: "var(--primary-color)" }}
              >
                {hasGoogleProvider ? "Google Linked" : "Link Google"}
              </button>
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

          <div className="bg-white rounded-xl shadow p-6 mb-6">
            <h2 className="text-xl font-semibold mb-2">Cookie Preferences</h2>
            <p className="text-sm text-gray-600 mb-4">
              Essential auth/session storage is always enabled. Optional preference cookies can be managed here.
            </p>
            <p className="text-sm text-gray-700 mb-3">
              Current: <span className="font-semibold">{cookieConsent || "not set"}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => writeCookieConsent("accepted")}
                className="px-4 py-2 rounded text-white font-semibold"
                style={{ backgroundColor: "var(--primary-color)" }}
              >
                Accept Optional
              </button>
              <button
                type="button"
                onClick={() => writeCookieConsent("rejected")}
                className="px-4 py-2 rounded border font-semibold"
              >
                Reject Optional
              </button>
              <button
                type="button"
                onClick={() => clearCookieConsent()}
                className="px-4 py-2 rounded border font-semibold"
              >
                Reset Prompt
              </button>
            </div>
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

          <div className="bg-white rounded-xl shadow p-6 mt-6 border border-red-200">
            <h2 className="text-xl font-semibold text-red-700 mb-2">Danger Zone</h2>
            <p className="text-sm text-gray-700 mb-4">
              Deleting your account permanently removes your profile and pending join requests.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Type DELETE to confirm
                </label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  className="w-full border rounded-lg p-3"
                  placeholder="DELETE"
                  disabled={deletingAccount}
                />
              </div>
              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={deletingAccount || loading}
                className="px-6 py-2 rounded-lg text-white font-semibold bg-red-600 hover:bg-red-700 disabled:opacity-50"
              >
                {deletingAccount ? "Deleting Account..." : "Delete Account"}
              </button>
            </div>
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

