"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/app/AuthContext";
import { Link as LinkIcon, Trash2 } from "lucide-react";
import { updateSecureUserDoc } from "@/app/utils/secureUserDoc";

function isValidImageUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export default function ProfilePictureUpload() {
  const { currentUser, userData, refreshUserData } = useAuth();
  const [saving, setSaving] = useState(false);
  const [photoUrlInput, setPhotoUrlInput] = useState("");

  useEffect(() => {
    setPhotoUrlInput(userData?.photoURL || "");
  }, [userData?.photoURL]);

  const handleSaveUrl = async () => {
    if (!currentUser) return;
    const normalized = photoUrlInput.trim();
    if (!normalized) {
      alert("Enter an image URL first.");
      return;
    }
    if (!isValidImageUrl(normalized)) {
      alert("Please enter a valid http(s) image URL.");
      return;
    }

    setSaving(true);
    try {
      await updateSecureUserDoc(currentUser.uid, {
        photoURL: normalized,
      });

      if (refreshUserData) {
        await refreshUserData();
      }

      alert("Profile picture URL updated.");
    } catch (error) {
      console.error("Error updating profile picture URL:", error);
      alert("Error updating profile picture URL");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveUrl = async () => {
    if (!currentUser) return;
    setSaving(true);
    try {
      await updateSecureUserDoc(currentUser.uid, {
        photoURL: "",
      });
      if (refreshUserData) {
        await refreshUserData();
      }
      setPhotoUrlInput("");
      alert("Profile picture removed.");
    } catch (error) {
      console.error("Error removing profile picture URL:", error);
      alert("Error removing profile picture URL");
    } finally {
      setSaving(false);
    }
  };

  const getInitials = () => {
    if (!userData?.displayName) return "?";
    const names = userData.displayName.split(" ");
    if (names.length >= 2) {
      return names[0][0] + names[1][0];
    }
    return names[0][0];
  };

  const currentPhotoURL = userData?.photoURL;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-6">
        {/* Current Picture */}
        <div className="relative">
          {currentPhotoURL ? (
            <img
              src={currentPhotoURL}
              alt="Profile"
              className="w-32 h-32 rounded-full object-cover border-4 border-gray-300"
            />
          ) : (
            <div className="w-32 h-32 rounded-full bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center text-white text-4xl font-bold border-4 border-gray-300">
              {getInitials()}
            </div>
          )}
        </div>

        {/* URL controls */}
        <div className="flex-1">
          <div className="space-y-2">
            <p className="text-sm font-medium">Profile Picture URL</p>
            <input
              type="url"
              value={photoUrlInput}
              onChange={(event) => setPhotoUrlInput(event.target.value)}
              className="w-full border rounded-lg p-2"
              placeholder="https://example.com/profile.jpg"
              disabled={saving}
            />
            <div className="flex gap-2">
              <button
                onClick={handleSaveUrl}
                disabled={saving}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2 text-sm"
              >
                <LinkIcon size={16} />
                {saving ? "Saving..." : "Save URL"}
              </button>
              <button
                onClick={handleRemoveUrl}
                disabled={saving || !currentPhotoURL}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 flex items-center gap-2 text-sm"
              >
                <Trash2 size={16} />
                Remove
              </button>
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-500">
        Your profile picture URL will be visible to all team members
      </p>
    </div>
  );
}
