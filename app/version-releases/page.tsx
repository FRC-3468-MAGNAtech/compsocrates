"use client";

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDocs, updateDoc } from "firebase/firestore";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { db } from "@/app/firebase";

type ReleaseNote = {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt?: number;
  authorName?: string;
};

function VersionReleasesContent() {
  const { userData } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState<ReleaseNote[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [canEdit, setCanEdit] = useState(false);

  useEffect(() => {
    void loadNotes();
  }, []);

  useEffect(() => {
    async function loadOwnerAccess() {
      if (!userData?.uid) {
        setCanEdit(false);
        return;
      }
      try {
        const response = await fetch("/api/owner/release-access", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uid: userData.uid, email: userData.email || "" }),
        });
        if (!response.ok) {
          setCanEdit(Boolean(userData?.canManageVersionReleases));
          return;
        }
        const payload = (await response.json()) as { allowed?: boolean };
        setCanEdit(Boolean(payload.allowed));
      } catch {
        setCanEdit(Boolean(userData?.canManageVersionReleases));
      }
    }
    void loadOwnerAccess();
  }, [userData?.uid, userData?.email, userData?.canManageVersionReleases]);

  async function loadNotes() {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, "versionReleases"));
      const loaded = snap.docs
        .map((docSnap) => {
          const data = docSnap.data() as Record<string, unknown>;
          return {
            id: docSnap.id,
            title: String(data.title || "Untitled"),
            body: String(data.body || ""),
            createdAt: Number(data.createdAt || 0),
            updatedAt: Number(data.updatedAt || 0) || undefined,
            authorName: String(data.authorName || ""),
          } as ReleaseNote;
        })
        .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
      setNotes(loaded);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!canEdit) return;
    const title = draftTitle.trim();
    const body = draftBody.trim();
    if (!title || !body) {
      alert("Title and details are required.");
      return;
    }
    setSaving(true);
    try {
      await addDoc(collection(db, "versionReleases"), {
        title,
        body,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        authorUid: userData?.uid || "",
        authorName: userData?.displayName || "",
      });
      setDraftTitle("");
      setDraftBody("");
      await loadNotes();
    } catch (error) {
      console.error("Failed to publish release note:", error);
      alert("Unable to publish this release note.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(note: ReleaseNote) {
    if (!canEdit) return;
    const title = draftTitle.trim();
    const body = draftBody.trim();
    if (!title || !body) {
      alert("Title and details are required.");
      return;
    }
    setSaving(true);
    try {
      await updateDoc(doc(db, "versionReleases", note.id), {
        title,
        body,
        updatedAt: Date.now(),
      });
      setEditingId(null);
      setDraftTitle("");
      setDraftBody("");
      await loadNotes();
    } catch (error) {
      console.error("Failed to update release note:", error);
      alert("Unable to update this release note.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(note: ReleaseNote) {
    if (!canEdit) return;
    if (!window.confirm(`Delete "${note.title}"?`)) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db, "versionReleases", note.id));
      await loadNotes();
    } catch (error) {
      console.error("Failed to delete release note:", error);
      alert("Unable to delete this release note.");
    } finally {
      setSaving(false);
    }
  }

  function beginEdit(note: ReleaseNote) {
    setEditingId(note.id);
    setDraftTitle(note.title);
    setDraftBody(note.body);
  }

  const headingText = useMemo(
    () => (canEdit ? "Publish and update notes." : "Read-only notes for all users."),
    [canEdit]
  );

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto p-8">
        <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>
          Update Lot
        </h1>
        <p className="text-gray-600 mb-6">{headingText}</p>

        {canEdit && (
          <div className="bg-white rounded-xl shadow-md p-6 mb-6 space-y-3">
            <h2 className="text-lg font-semibold">{editingId ? "Edit Release" : "New Release"}</h2>
            <input
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              className="w-full border rounded p-2"
              placeholder="Title"
            />
            <textarea
              value={draftBody}
              onChange={(event) => setDraftBody(event.target.value)}
              className="w-full border rounded p-2 min-h-28"
              placeholder="What changed in this release?"
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (editingId) {
                    const note = notes.find((n) => n.id === editingId);
                    if (!note) return;
                    void handleUpdate(note);
                    return;
                  }
                  void handleCreate();
                }}
                disabled={saving}
                className="px-4 py-2 rounded text-white font-semibold disabled:opacity-60"
                style={{ backgroundColor: "var(--primary-color)" }}
              >
                {saving ? "Saving..." : editingId ? "Update Release" : "Publish Release"}
              </button>
              {editingId && (
                <button
                  onClick={() => {
                    setEditingId(null);
                    setDraftTitle("");
                    setDraftBody("");
                  }}
                  className="px-4 py-2 rounded border"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}

        <div className="space-y-4">
          {loading ? (
            <div className="bg-white rounded-xl shadow-md p-6 text-gray-600">Loading releases...</div>
          ) : notes.length === 0 ? (
            <div className="bg-white rounded-xl shadow-md p-6 text-gray-600">No release notes published yet.</div>
          ) : (
            notes.map((note) => (
              <div key={note.id} className="bg-white rounded-xl shadow-md p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-semibold">{note.title}</h3>
                    <p className="text-xs text-gray-500 mt-1">
                      {new Date(note.updatedAt || note.createdAt).toLocaleString()}
                      {note.authorName ? ` • ${note.authorName}` : ""}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => beginEdit(note)}
                        className="px-3 py-1.5 rounded border text-sm"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => void handleDelete(note)}
                        className="px-3 py-1.5 rounded border border-red-200 text-red-700 text-sm"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
                <p className="mt-3 whitespace-pre-wrap text-gray-700">{note.body}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function VersionReleasesPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <VersionReleasesContent />
    </ProtectedRoute>
  );
}
