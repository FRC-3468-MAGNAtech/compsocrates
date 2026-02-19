"use client";

import { useState, useEffect } from "react";
import { deleteField, doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import { useAuth } from "@/app/AuthContext";
import { Key, Check, X, AlertCircle } from "lucide-react";
import { LoadingSpinnerSmall } from "@/app/components/LoadingSpinner";

export default function TBAKeySettings() {
  const { userData } = useAuth();
  const [apiKey, setApiKey] = useState("");
  const [savedKey, setSavedKey] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [isValid, setIsValid] = useState<boolean | null>(null);

  useEffect(() => {
    loadTeamKey();
  }, [userData?.teamId]);

  async function loadTeamKey() {
    if (!userData?.teamId) return;

    try {
      const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
      if (teamDoc.exists() && (teamDoc.data().tbaApiKeyEncrypted || teamDoc.data().tbaApiKey)) {
        // We no longer display plaintext keys after save.
        setSavedKey("configured");
        setApiKey("");
      }
    } catch (error) {
      console.error("Error loading TBA key:", error);
    } finally {
      setLoading(false);
    }
  }

  async function validateKey(key: string): Promise<boolean> {
    try {
      const response = await fetch("https://www.thebluealliance.com/api/v3/status", {
        headers: {
          "X-TBA-Auth-Key": key
        }
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  async function handleSave() {
    if (!userData?.teamId || !apiKey.trim()) return;

    setSaving(true);
    setValidating(true);

    try {
      // Validate key first
      const valid = await validateKey(apiKey.trim());
      setIsValid(valid);
      setValidating(false);

      if (!valid) {
        alert("Invalid TBA API key. Please check and try again.");
        setSaving(false);
        return;
      }

      const encryptionResponse = await fetch("/api/tba/encrypt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: apiKey.trim() }),
      });
      if (!encryptionResponse.ok) {
        throw new Error("Failed to encrypt key");
      }
      const encryptionPayload = await encryptionResponse.json();
      const encryptedKey =
        typeof encryptionPayload?.encryptedKey === "string" ? encryptionPayload.encryptedKey : "";
      if (!encryptedKey) {
        throw new Error("No encrypted key returned");
      }

      // Save encrypted key to team document
      await updateDoc(doc(db, "teams", userData.teamId), {
        tbaApiKeyEncrypted: encryptedKey,
        tbaApiKey: deleteField(),
      });

      setSavedKey("configured");
      setApiKey("");
      setIsEditing(false);
      alert("TBA API key saved successfully!");
    } catch (error) {
      console.error("Error saving TBA key:", error);
      alert("Error saving API key");
      setIsValid(false);
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setApiKey("");
    setIsEditing(false);
    setIsValid(null);
  }

  if (!userData?.isTeamAdmin) {
    return (
      <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600">
        Only team admins can manage the TBA API key
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <LoadingSpinnerSmall />
        <span>Loading...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <Key className="text-blue-600 mt-1" size={20} />
        <div className="flex-1">
          <h3 className="font-medium mb-1">The Blue Alliance API Key</h3>
          <p className="text-sm text-gray-600 mb-3">
            Add your team's TBA API key to enable features like importing teams and match data.
            <a
              href="https://www.thebluealliance.com/account"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline ml-1"
            >
              Get your key here →
            </a>
          </p>

          {!isEditing && savedKey ? (
            <div className="flex items-center gap-3">
              <div className="bg-gray-100 px-4 py-2 rounded-lg font-mono text-sm flex-1">
                Key saved (encrypted)
              </div>
              <button
                onClick={() => setIsEditing(true)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm"
              >
                Change Key
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <input
                  type="text"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setIsValid(null);
                  }}
                  placeholder="Enter your TBA API key"
                  className="w-full border rounded-lg px-4 py-2 font-mono text-sm"
                  disabled={saving}
                />
                {isValid === false && (
                  <div className="flex items-center gap-2 mt-2 text-red-600 text-sm">
                    <AlertCircle size={16} />
                    <span>Invalid API key</span>
                  </div>
                )}
                {isValid === true && (
                  <div className="flex items-center gap-2 mt-2 text-green-600 text-sm">
                    <Check size={16} />
                    <span>Valid API key</span>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving || !apiKey.trim()}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm flex items-center gap-2"
                >
                  {validating ? (
                    <>Validating...</>
                  ) : saving ? (
                    <>Saving...</>
                  ) : (
                    <>
                      <Check size={16} />
                      Save Key
                    </>
                  )}
                </button>

                {(isEditing || !savedKey) && savedKey && (
                  <button
                    onClick={handleCancel}
                    disabled={saving}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 text-sm flex items-center gap-2"
                  >
                    <X size={16} />
                    Cancel
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-900">
          <strong>Why do we need this?</strong> Your TBA API key lets us fetch official team lists, match schedules, and results. Each team should use their own key to distribute API load.
        </p>
      </div>
    </div>
  );
}
