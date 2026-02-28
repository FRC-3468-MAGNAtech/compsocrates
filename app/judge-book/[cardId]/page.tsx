"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { doc, getDoc, getDocs, query, setDoc, updateDoc, where, collection } from "firebase/firestore";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { db } from "@/app/firebase";
import { normalizeFormAccessOverrides, type FormAccessOverrides } from "@/app/utils/roles";
import { canEditJudgeBook, normalizeJudgeBookCard, sortJudgeBookCards, type JudgeBookCard } from "@/app/utils/judgeBook";

type EditDraft = {
  prompt: string;
  answer: string;
  imageUrl: string;
};

function JudgeBookCardPageContent() {
  const { userData } = useAuth();
  const params = useParams();
  const cardId = String(params.cardId || "");

  const [card, setCard] = useState<JudgeBookCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formAccessOverrides, setFormAccessOverrides] = useState<FormAccessOverrides>({});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EditDraft>({ prompt: "", answer: "", imageUrl: "" });

  const canEdit = useMemo(() => canEditJudgeBook(userData, formAccessOverrides), [userData, formAccessOverrides]);

  function toTeamCardPayload(cardValue: JudgeBookCard) {
    return {
      id: cardValue.id,
      teamId: cardValue.teamId,
      prompt: cardValue.prompt,
      answer: cardValue.answer,
      imageUrl: cardValue.imageUrl || "",
      createdAt: cardValue.createdAt,
      updatedAt: cardValue.updatedAt,
      createdByUid: cardValue.createdByUid || "",
      createdByName: cardValue.createdByName || "",
      updatedByUid: cardValue.updatedByUid || "",
      updatedByName: cardValue.updatedByName || "",
    };
  }

  useEffect(() => {
    async function loadCard() {
      if (!cardId || !userData?.teamId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
        setFormAccessOverrides(normalizeFormAccessOverrides(teamDoc.exists() ? teamDoc.data().formAccessOverrides : null));
        if (teamDoc.exists()) {
          const teamRows: JudgeBookCard[] = (Array.isArray(teamDoc.data().judgeBookCards) ? teamDoc.data().judgeBookCards : [])
            .map((value: unknown) => normalizeJudgeBookCard(value))
            .filter((value: JudgeBookCard | null): value is JudgeBookCard => Boolean(value))
            .map((value: JudgeBookCard) => ({ ...value, teamId: userData.teamId, source: "team-doc" as const }));
          const fromTeam = teamRows.find((value: JudgeBookCard) => value.id === cardId) || null;
          if (fromTeam) {
            setCard(fromTeam);
            setDraft({
              prompt: fromTeam.prompt || "",
              answer: fromTeam.answer || "",
              imageUrl: fromTeam.imageUrl || "",
            });
            return;
          }
        }

        // Legacy fallback if older cards are still in top-level collection.
        const legacySnapshot = await getDocs(query(collection(db, "judgeBookCards"), where("teamId", "==", userData.teamId)));
        const legacyRows: JudgeBookCard[] = legacySnapshot.docs.map((docSnap: { id: string; data: () => unknown }) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<JudgeBookCard, "id">),
          source: "legacy-collection" as const,
        }));
        const legacyCard = legacyRows.find((value: JudgeBookCard) => value.id === cardId) || null;
        if (!legacyCard) {
          setCard(null);
          return;
        }
        setCard(legacyCard);
        setDraft({
          prompt: legacyCard.prompt || "",
          answer: legacyCard.answer || "",
          imageUrl: legacyCard.imageUrl || "",
        });
      } catch (error) {
        console.error("Failed to load judge book card:", error);
        setCard(null);
      } finally {
        setLoading(false);
      }
    }

    void loadCard();
  }, [cardId, userData?.teamId]);

  async function handleSave() {
    if (!card || !userData?.uid || !userData?.teamId || !canEdit) return;
    const prompt = draft.prompt.trim();
    if (!prompt) {
      alert("Question/title is required.");
      return;
    }

    setSaving(true);
    try {
      const now = Date.now();
      const next = {
        ...card,
        prompt,
        answer: draft.answer.trim(),
        imageUrl: draft.imageUrl.trim(),
        updatedAt: now,
        updatedByUid: userData.uid,
        updatedByName: userData.displayName || "Unknown",
      };
      if (card.source === "legacy-collection") {
        await updateDoc(doc(db, "judgeBookCards", card.id), {
          prompt: next.prompt,
          answer: next.answer,
          imageUrl: next.imageUrl,
          updatedAt: next.updatedAt,
          updatedByUid: next.updatedByUid,
          updatedByName: next.updatedByName,
        });
      } else {
        const teamDocRef = doc(db, "teams", userData.teamId);
        const teamDoc = await getDoc(teamDocRef);
        const teamRows = (teamDoc.exists() && Array.isArray(teamDoc.data().judgeBookCards) ? teamDoc.data().judgeBookCards : [])
          .map((value: unknown) => normalizeJudgeBookCard(value))
          .filter((value: JudgeBookCard | null): value is JudgeBookCard => Boolean(value))
          .map((value: JudgeBookCard) => ({ ...value, teamId: userData.teamId, source: "team-doc" as const }));
        const mergedRows = sortJudgeBookCards(
          teamRows.map((entry: JudgeBookCard) => (entry.id === card.id ? { ...next, source: "team-doc" as const } : entry))
        );
        try {
          await setDoc(
            teamDocRef,
            {
              judgeBookCards: mergedRows.map((entry) => toTeamCardPayload(entry)),
              judgeBookUpdatedAt: Date.now(),
            },
            { merge: true }
          );
        } catch {
          await setDoc(
            doc(db, "judgeBookCards", card.id),
            {
              ...toTeamCardPayload({ ...next, source: "legacy-collection" }),
            },
            { merge: true }
          );
        }
      }
      setCard(next);
      setEditing(false);
    } catch (error) {
      console.error("Failed to update judge book card:", error);
      alert("Unable to save this card.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto p-8">
        <div className="mb-4">
          <Link href="/judge-book" className="text-sm text-gray-700 hover:underline">Back to Judge Book</Link>
        </div>

        {loading ? (
          <div className="bg-white rounded-xl shadow-md p-6">Loading card...</div>
        ) : !card ? (
          <div className="bg-white rounded-xl shadow-md p-6">Card not found.</div>
        ) : (
          <div className="bg-white rounded-2xl shadow-md border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200">
              {editing ? (
                <input
                  value={draft.prompt}
                  onChange={(event) => setDraft((prev) => ({ ...prev, prompt: event.target.value }))}
                  className="w-full border rounded p-2 text-2xl font-bold"
                />
              ) : (
                <h1 className="text-3xl font-bold" style={{ color: "var(--primary-color)" }}>{card.prompt}</h1>
              )}
              <p className="text-xs text-gray-500 mt-2">Updated {new Date(card.updatedAt || card.createdAt || 0).toLocaleString()}</p>
            </div>

            <div className="p-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
              <div>
                {editing ? (
                  <textarea
                    value={draft.answer}
                    onChange={(event) => setDraft((prev) => ({ ...prev, answer: event.target.value }))}
                    className="w-full border rounded p-3 min-h-[260px]"
                  />
                ) : (
                  <p className="text-gray-800 whitespace-pre-wrap min-h-[260px]">{card.answer || ""}</p>
                )}
              </div>

              <div className="min-h-[260px] rounded-xl border border-gray-200 bg-gray-50 overflow-hidden">
                {(editing ? draft.imageUrl.trim() : String(card.imageUrl || "").trim()) ? (
                  // Keep this section dedicated for optional charts/images.
                  <img
                    src={(editing ? draft.imageUrl : String(card.imageUrl || "")).trim()}
                    alt="Judge Book visual"
                    className="w-full h-full object-cover min-h-[260px]"
                  />
                ) : (
                  <div className="w-full h-full min-h-[260px]" />
                )}
              </div>
            </div>

            {canEdit && (
              <div className="p-6 border-t border-gray-200">
                {editing ? (
                  <>
                    <input
                      value={draft.imageUrl}
                      onChange={(event) => setDraft((prev) => ({ ...prev, imageUrl: event.target.value }))}
                      className="w-full border rounded p-2 mb-3"
                      placeholder="Optional image URL"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => void handleSave()}
                        disabled={saving}
                        className="px-4 py-2 rounded text-white font-semibold disabled:opacity-60"
                        style={{ backgroundColor: "var(--primary-color)" }}
                      >
                        {saving ? "Saving..." : "Save"}
                      </button>
                      <button
                        onClick={() => {
                          setEditing(false);
                          setDraft({
                            prompt: card.prompt || "",
                            answer: card.answer || "",
                            imageUrl: card.imageUrl || "",
                          });
                        }}
                        className="px-4 py-2 rounded border"
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    onClick={() => setEditing(true)}
                    className="px-4 py-2 rounded text-white font-semibold"
                    style={{ backgroundColor: "var(--primary-color)" }}
                  >
                    Edit Card
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function JudgeBookCardPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <JudgeBookCardPageContent />
    </ProtectedRoute>
  );
}
