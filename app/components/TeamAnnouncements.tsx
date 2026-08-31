"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/app/firebase";
import { useAuth } from "@/app/AuthContext";

type AnnouncementType = "announcement" | "strategy-note" | "match-alert";

type TeamAnnouncement = {
  id: string;
  teamId: string;
  authorId: string;
  authorName: string;
  body: string;
  type: AnnouncementType;
  createdAt: number;
};

const TYPE_LABELS: Record<AnnouncementType, string> = {
  announcement: "Announcement",
  "strategy-note": "Strategy Note",
  "match-alert": "Match Alert",
};

const TYPE_STYLES: Record<AnnouncementType, string> = {
  announcement: "bg-gray-100 text-gray-700",
  "strategy-note": "bg-yellow-100 text-yellow-800",
  "match-alert": "bg-red-100 text-red-800",
};

export default function TeamAnnouncements({ teamId }: { teamId: string | null | undefined }) {
  const { userData } = useAuth();
  const [posts, setPosts] = useState<TeamAnnouncement[]>([]);
  const [body, setBody] = useState("");
  const [type, setType] = useState<AnnouncementType>("announcement");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!teamId) {
      setPosts([]);
      return;
    }
    const postsQuery = query(
      collection(db, "teamAnnouncements"),
      where("teamId", "==", teamId),
      orderBy("createdAt", "desc")
    );
    const unsubscribe = onSnapshot(
      postsQuery,
      (snapshot) => {
        setPosts(
          snapshot.docs.map((row) => ({ id: row.id, ...(row.data() as Omit<TeamAnnouncement, "id">) }))
        );
      },
      (listenError) => {
        console.error("Failed to load team announcements:", listenError);
      }
    );
    return () => unsubscribe();
  }, [teamId]);

  const canDelete = useMemo(() => Boolean(userData?.isTeamAdmin), [userData?.isTeamAdmin]);

  async function handlePost(event: React.FormEvent) {
    event.preventDefault();
    if (!teamId || !userData?.uid) return;
    const trimmed = body.trim();
    if (!trimmed) {
      setError("Write a message before posting.");
      return;
    }
    setPosting(true);
    setError("");
    try {
      await addDoc(collection(db, "teamAnnouncements"), {
        teamId,
        authorId: userData.uid,
        authorName: userData.displayName || "Team Member",
        body: trimmed,
        type,
        createdAt: Date.now(),
      });
      setBody("");
    } catch (postError) {
      console.error("Failed to post team announcement:", postError);
      setError("Unable to post right now. Try again in a moment.");
    } finally {
      setPosting(false);
    }
  }

  async function handleDelete(postId: string) {
    if (!canDelete) return;
    if (!window.confirm("Delete this post?")) return;
    try {
      await deleteDoc(doc(db, "teamAnnouncements", postId));
    } catch (deleteError) {
      console.error("Failed to delete team announcement:", deleteError);
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200">
      <h2 className="text-xl font-semibold mb-2">Team Communication</h2>
      <p className="text-sm text-gray-600 mb-4">
        Post announcements, strategy notes, and match alerts for the whole team to see.
      </p>

      <form onSubmit={handlePost} className="mb-5 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(TYPE_LABELS) as AnnouncementType[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setType(option)}
              className={`rounded-full px-3 py-1 text-xs font-semibold border ${
                type === option ? "border-gray-800 bg-gray-800 text-white" : "border-gray-200 text-gray-600"
              }`}
            >
              {TYPE_LABELS[option]}
            </button>
          ))}
        </div>
        <textarea
          className="w-full rounded-lg border border-gray-200 p-3 text-sm"
          rows={3}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Share an update with your team..."
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={posting}
          className="px-4 py-2 rounded text-white text-sm font-semibold disabled:opacity-60"
          style={{ backgroundColor: "var(--primary-color)" }}
        >
          {posting ? "Posting..." : "Post"}
        </button>
      </form>

      <div className="space-y-3 max-h-96 overflow-y-auto">
        {posts.length === 0 ? (
          <p className="text-sm text-gray-500">No posts yet.</p>
        ) : (
          posts.map((post) => (
            <div key={post.id} className="rounded-lg border border-gray-200 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TYPE_STYLES[post.type]}`}>
                    {TYPE_LABELS[post.type] || "Announcement"}
                  </span>
                  <p className="text-sm font-semibold">{post.authorName}</p>
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-xs text-gray-500">{new Date(post.createdAt).toLocaleString()}</p>
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => handleDelete(post.id)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">{post.body}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
