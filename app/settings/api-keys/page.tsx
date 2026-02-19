"use client";

import { useState, useEffect } from "react";
import { deleteField, doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { useAuth } from "@/app/AuthContext";
import { Key, Save, Eye, EyeOff } from "lucide-react";

function APIKeysContent() {
  const { userData } = useAuth();
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAPIKey();
  }, [userData?.teamId]);

  async function loadAPIKey() {
    if (!userData?.teamId) return;

    try {
      const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
      if (teamDoc.exists()) {
        const data = teamDoc.data();
        setHasStoredKey(Boolean(data.tbaApiKeyEncrypted || data.tbaApiKey));
        setApiKey("");
      }
    } catch (error) {
      console.error("Error loading API key:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!userData?.teamId) return;
    
    if (!apiKey.trim()) {
      alert("Please enter an API key");
      return;
    }

    setSaving(true);
    try {
      let storedEncrypted = false;
      const encryptionResponse = await fetch("/api/tba/encrypt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: apiKey.trim() }),
      });
      if (encryptionResponse.ok) {
        const encryptionPayload = await encryptionResponse.json();
        const encryptedKey =
          typeof encryptionPayload?.encryptedKey === "string" ? encryptionPayload.encryptedKey : "";
        if (encryptedKey) {
          await setDoc(
            doc(db, "teams", userData.teamId),
            {
              tbaApiKeyEncrypted: encryptedKey,
              tbaApiKey: deleteField(),
            },
            { merge: true }
          );
          storedEncrypted = true;
        }
      }

      if (!storedEncrypted) {
        // Fallback for environments missing server encryption secret.
        await setDoc(
          doc(db, "teams", userData.teamId),
          {
            tbaApiKey: apiKey.trim(),
          },
          { merge: true }
        );
      }

      setHasStoredKey(true);
      setApiKey("");
      alert(storedEncrypted ? "API key saved successfully!" : "API key saved (fallback mode).");
    } catch (error) {
      console.error("Error saving API key:", error);
      alert("Failed to save API key");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <LoadingSpinner message="Loading API settings..." />
        </div>
      </div>
    );
  }

  if (userData && !(userData.role === "coach" || userData.isTeamAdmin)) {
    return (
      <div className="flex h-screen bg-gray-50">
        <Sidebar />
        <div className="flex-1 overflow-auto p-8">
          <div className="max-w-xl bg-white rounded-xl shadow-md p-6">
            <h1 className="text-2xl font-bold mb-2 theme-text">Team API Keys</h1>
            <p className="text-gray-600">Only team admins and coaches can manage API keys.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-2xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
              Team API Keys
            </h1>
            <p className="text-gray-600">
              Manage your team's The Blue Alliance API key
            </p>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6">
            <div className="flex items-center gap-3 mb-4">
              <Key size={24} style={{ color: "#c42221" }} />
              <h2 className="text-xl font-semibold">The Blue Alliance API Key</h2>
            </div>

            <div className="mb-6">
              <p className="text-sm text-gray-600 mb-4">
                Your team's TBA API key is used to fetch match schedules, team data, and event information.
                Each team should use their own API key to avoid rate limiting.
              </p>

              <div className="bg-blue-50 border-l-4 border-blue-500 p-4 mb-4">
                <p className="text-sm text-blue-800">
                  <strong>Don't have an API key?</strong> Request one at{" "}
                  <a 
                    href="https://www.thebluealliance.com/account" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="underline hover:text-blue-900"
                  >
                    thebluealliance.com/account
                  </a>
                </p>
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                API Key
              </label>
              {hasStoredKey && (
                <p className="text-xs text-green-700 mb-2">A key is already saved (encrypted at rest).</p>
              )}
              <div className="relative">
                <input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Enter your TBA API key"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                >
                  {showKey ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full py-3 rounded-lg font-semibold text-white flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              style={{ backgroundColor: "#c42221" }}
            >
              {saving ? (
                <>Saving...</>
              ) : (
                <>
                  <Save size={20} />
                  Save API Key
                </>
              )}
            </button>
          </div>

          <div className="mt-6 bg-yellow-50 border-l-4 border-yellow-400 p-4">
            <p className="text-sm text-yellow-800">
              <strong>Security Note:</strong> Your API key is stored securely and only accessible to team admins.
              Never share your API key publicly.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function APIKeysPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach", "scout"]}>
      <APIKeysContent />
    </ProtectedRoute>
  );
}
