"use client";

import { useState, useRef } from "react";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "@/app/firebase";
import { useAuth } from "@/app/AuthContext";
import { Camera, Upload, X } from "lucide-react";
import { updateSecureUserDoc } from "@/app/utils/secureUserDoc";

export default function ProfilePictureUpload() {
  const { currentUser, userData, refreshUserData } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      alert("Please select an image file");
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert("Image must be smaller than 5MB");
      return;
    }

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleUpload = async () => {
    if (!preview || !currentUser) return;

    setUploading(true);
    try {
      // Convert preview to blob
      const response = await fetch(preview);
      const blob = await response.blob();

      // Upload to Firebase Storage
      const storageRef = ref(storage, `profilePictures/${currentUser.uid}`);
      await uploadBytes(storageRef, blob);

      // Get download URL
      const downloadURL = await getDownloadURL(storageRef);

      // Update user document
      await updateSecureUserDoc(currentUser.uid, {
        photoURL: downloadURL
      });

      // Refresh user data
      if (refreshUserData) {
        await refreshUserData();
      }

      alert("Profile picture updated!");
      setPreview(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
      console.error("Error uploading:", error);
      alert("Error uploading profile picture");
    } finally {
      setUploading(false);
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
        {/* Current/Preview Picture */}
        <div className="relative">
          {preview ? (
            <img
              src={preview}
              alt="Preview"
              className="w-32 h-32 rounded-full object-cover border-4 border-red-600"
            />
          ) : currentPhotoURL ? (
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

          {/* Camera icon button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="absolute bottom-0 right-0 bg-red-600 text-white p-2 rounded-full hover:bg-red-700 shadow-lg"
            disabled={uploading}
          >
            <Camera size={20} />
          </button>
        </div>

        {/* Upload controls */}
        <div className="flex-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />

          {preview ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">Ready to upload new picture</p>
              <div className="flex gap-2">
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
                >
                  <Upload size={16} />
                  {uploading ? "Uploading..." : "Upload"}
                </button>
                <button
                  onClick={() => {
                    setPreview(null);
                    if (fileInputRef.current) {
                      fileInputRef.current.value = "";
                    }
                  }}
                  disabled={uploading}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 flex items-center gap-2"
                >
                  <X size={16} />
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-medium">Profile Picture</p>
              <p className="text-sm text-gray-600">
                JPG, PNG or GIF. Max size 5MB.
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
              >
                Choose Photo
              </button>
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-500">
        Your profile picture will be visible to all team members
      </p>
    </div>
  );
}
