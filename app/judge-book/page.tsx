"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { Plus } from "lucide-react";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { db } from "@/app/firebase";
import { parseCsvLine, splitCsvRecords, normalizeHeader } from "@/app/utils/csvHelpers";
import { normalizeFormAccessOverrides, type FormAccessOverrides } from "@/app/utils/roles";
import { canEditJudgeBook, normalizeJudgeBookCard, sortJudgeBookCards, type JudgeBookCard } from "@/app/utils/judgeBook";

type DraftCard = {
  prompt: string;
  answer: string;
  imageUrl: string;
};

function emptyDraft(): DraftCard {
  return { prompt: "", answer: "", imageUrl: "" };
}

function newJudgeBookId() {
  return `jb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toTeamCardPayload(card: JudgeBookCard) {
  return {
    id: card.id,
    teamId: card.teamId,
    prompt: card.prompt,
    answer: card.answer,
    imageUrl: card.imageUrl || "",
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    createdByUid: card.createdByUid || "",
    createdByName: card.createdByName || "",
    updatedByUid: card.updatedByUid || "",
    updatedByName: card.updatedByName || "",
  };
}

function JudgeBookPageContent() {
  const { userData } = useAuth();
  const [cards, setCards] = useState<JudgeBookCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formAccessOverrides, setFormAccessOverrides] = useState<FormAccessOverrides>({});
  const [singleDraft, setSingleDraft] = useState<DraftCard>(emptyDraft());
  const [multiDraft, setMultiDraft] = useState("");
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<DraftCard>(emptyDraft());
  const [searchQuery, setSearchQuery] = useState("");

  const canEdit = useMemo(() => canEditJudgeBook(userData, formAccessOverrides), [userData, formAccessOverrides]);
  const filteredCards = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) return cards;
    return cards.filter((card) => {
      const prompt = String(card.prompt || "").toLowerCase();
      const answer = String(card.answer || "").toLowerCase();
      return prompt.includes(normalizedQuery) || answer.includes(normalizedQuery);
    });
  }, [cards, searchQuery]);

  useEffect(() => {
    async function loadCardsAndPermissions() {
      if (!userData?.teamId) {
        setCards([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
        if (teamDoc.exists()) {
          const teamData = teamDoc.data() as Record<string, unknown>;
          setFormAccessOverrides(normalizeFormAccessOverrides(teamData.formAccessOverrides));
          const teamRows = (Array.isArray(teamData.judgeBookCards) ? teamData.judgeBookCards : [])
            .map((value) => normalizeJudgeBookCard(value))
            .filter((value): value is JudgeBookCard => Boolean(value))
            .map((value) => ({ ...value, teamId: userData.teamId, source: "team-doc" as const }));
          if (teamRows.length > 0) {
            setCards(sortJudgeBookCards(teamRows));
            return;
          }
        }
        // Legacy fallback collection read for backward compatibility.
        const cardsSnapshot = await getDocs(query(collection(db, "judgeBookCards"), where("teamId", "==", userData.teamId)));
        const legacyRows = cardsSnapshot.docs.map((docSnap) => {
          const data = docSnap.data() as Omit<JudgeBookCard, "id">;
          return { id: docSnap.id, ...data, source: "legacy-collection" as const } as JudgeBookCard;
        });
        setCards(sortJudgeBookCards(legacyRows));
      } catch (error) {
        console.error("Failed to load judge book cards:", error);
        setCards([]);
      } finally {
        setLoading(false);
      }
    }

    void loadCardsAndPermissions();
  }, [userData?.teamId]);

  async function createCards(rows: DraftCard[]) {
    if (!userData?.uid || !userData?.teamId || !canEdit) return;
    const safeRows = rows
      .map((row) => ({
        prompt: row.prompt.trim(),
        answer: row.answer.trim(),
        imageUrl: row.imageUrl.trim(),
      }))
      .filter((row) => row.prompt.length > 0);

    if (safeRows.length === 0) {
      alert("Add at least one card with a title/question.");
      return;
    }

    setSaving(true);
    try {
      const now = Date.now();
      const createdRows: JudgeBookCard[] = safeRows.map((row) => ({
        id: newJudgeBookId(),
        teamId: userData.teamId,
        prompt: row.prompt,
        answer: row.answer,
        imageUrl: row.imageUrl,
        createdAt: now,
        updatedAt: now,
        createdByUid: userData.uid || "",
        createdByName: userData.displayName || "Unknown",
        updatedByUid: userData.uid || "",
        updatedByName: userData.displayName || "Unknown",
        source: "team-doc",
      }));
      const teamDocRef = doc(db, "teams", userData.teamId);
      const nextTeamRows = sortJudgeBookCards([
        ...createdRows,
        ...cards.filter((card) => card.source !== "legacy-collection"),
      ]);
      try {
        await setDoc(
          teamDocRef,
          {
            judgeBookCards: nextTeamRows.map((card) => toTeamCardPayload(card)),
            judgeBookUpdatedAt: Date.now(),
          },
          { merge: true }
        );
      } catch {
        await Promise.all(
          createdRows.map((row) =>
            addDoc(collection(db, "judgeBookCards"), {
              ...toTeamCardPayload(row),
              source: "legacy-collection",
            })
          )
        );
      }
      setCards(nextTeamRows);
      setSingleDraft(emptyDraft());
      setMultiDraft("");
      setShowCreateModal(false);
      alert(`Added ${safeRows.length} Judge Book card${safeRows.length === 1 ? "" : "s"}.`);
    } catch (error) {
      console.error("Failed to create judge book cards:", error);
      alert("Unable to save Judge Book cards.");
    } finally {
      setSaving(false);
    }
  }

  function parseMultiDraft(text: string): DraftCard[] {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split("|").map((part) => part.trim());
        return {
          prompt: parts[0] || "",
          answer: parts[1] || "",
          imageUrl: parts[2] || "",
        };
      });
  }

  async function handleCsvImport(file: File | null) {
    if (!file || !canEdit) return;
    const text = await file.text();
    const records = splitCsvRecords(text);
    if (records.length === 0) {
      alert("CSV appears empty.");
      return;
    }

    const headerCells = parseCsvLine(records[0]);
    const normalized = headerCells.map((cell) => normalizeHeader(cell));
    const promptIndex = normalized.findIndex((value) => ["question", "prompt", "title", "label"].includes(value));
    const answerIndex = normalized.findIndex((value) => ["answer", "response", "value", "details"].includes(value));
    const imageIndex = normalized.findIndex((value) => ["image", "imageurl", "img", "photo", "chart"].includes(value));
    const hasHeader = promptIndex >= 0 || answerIndex >= 0 || imageIndex >= 0;

    const dataRecords = hasHeader ? records.slice(1) : records;
    const parsedRows = dataRecords
      .map((record) => parseCsvLine(record))
      .map((cells) => ({
        prompt: String(cells[hasHeader && promptIndex >= 0 ? promptIndex : 0] || "").trim(),
        answer: String(cells[hasHeader && answerIndex >= 0 ? answerIndex : 1] || "").trim(),
        imageUrl: String(cells[hasHeader && imageIndex >= 0 ? imageIndex : 2] || "").trim(),
      }));

    await createCards(parsedRows);
  }

  async function handleDeleteCard(cardId: string) {
    if (!canEdit || !userData?.teamId) return;
    if (!window.confirm("Delete this Judge Book card?")) return;

    try {
      const target = cards.find((card) => card.id === cardId);
      if (!target) return;
      if (target.source === "legacy-collection") {
        await deleteDoc(doc(db, "judgeBookCards", cardId));
        setCards((prev) => prev.filter((card) => card.id !== cardId));
        return;
      }
      const nextRows = cards.filter((card) => card.id !== cardId && card.source !== "legacy-collection");
      try {
        await setDoc(
          doc(db, "teams", userData.teamId),
          {
            judgeBookCards: nextRows.map((card) => toTeamCardPayload(card)),
            judgeBookUpdatedAt: Date.now(),
          },
          { merge: true }
        );
      } catch {
        await deleteDoc(doc(db, "judgeBookCards", cardId));
      }
      setCards(sortJudgeBookCards(nextRows));
    } catch (error) {
      console.error("Failed to delete judge book card:", error);
      alert("Unable to delete this card right now.");
    }
  }

  function startEdit(card: JudgeBookCard) {
    setEditingCardId(card.id);
    setEditDraft({
      prompt: card.prompt || "",
      answer: card.answer || "",
      imageUrl: card.imageUrl || "",
    });
  }

  async function handleSaveEdit(cardId: string) {
    if (!canEdit || !userData?.uid) return;
    const prompt = editDraft.prompt.trim();
    if (!prompt) {
      alert("Question/title is required.");
      return;
    }

    try {
      const now = Date.now();
      const nextCards = cards.map((card) =>
        card.id === cardId
          ? {
              ...card,
              prompt,
              answer: editDraft.answer.trim(),
              imageUrl: editDraft.imageUrl.trim(),
              updatedAt: now,
              updatedByUid: userData.uid,
              updatedByName: userData.displayName || "Unknown",
            }
          : card
      );
      const updatedCard = nextCards.find((card) => card.id === cardId);
      if (!updatedCard) {
        throw new Error("Card not found after update.");
      }
      if (updatedCard.source === "legacy-collection") {
        await updateDoc(doc(db, "judgeBookCards", cardId), {
          prompt: updatedCard.prompt,
          answer: updatedCard.answer,
          imageUrl: updatedCard.imageUrl || "",
          updatedAt: now,
          updatedByUid: userData.uid,
          updatedByName: userData.displayName || "Unknown",
        });
      } else {
        const teamRows = nextCards.filter((card) => card.source !== "legacy-collection");
        try {
          await setDoc(
            doc(db, "teams", userData.teamId),
            {
              judgeBookCards: teamRows.map((card) => toTeamCardPayload(card)),
              judgeBookUpdatedAt: Date.now(),
            },
            { merge: true }
          );
        } catch {
          await setDoc(
            doc(db, "judgeBookCards", cardId),
            {
              ...toTeamCardPayload({
                ...updatedCard,
                source: "legacy-collection",
              }),
            },
            { merge: true }
          );
        }
      }
      setCards(sortJudgeBookCards(nextCards));
      setEditingCardId(null);
      setEditDraft(emptyDraft());
    } catch (error) {
      console.error("Failed to update judge book card:", error);
      alert("Unable to update this card.");
    }
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto p-8">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>Judge Book</h1>
            <p className="text-gray-600">Build award interview notes with fast-edit cards and optional charts/images.</p>
          </div>
          {canEdit && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded text-white font-semibold"
              style={{ backgroundColor: "var(--primary-color)" }}
              aria-label="Create Judge Book cards"
              title="Create Judge Book cards"
            >
              <Plus size={18} />
              Add
            </button>
          )}
        </div>

        {!canEdit && (
          <div className="bg-white rounded-xl shadow-md p-4 border border-gray-200 mb-6 text-sm text-gray-700">
            Read-only access. Only Judge Awards, Team Coach, Team Admin, or members granted Permissions access can add or edit cards.
          </div>
        )}
        {!loading && cards.length > 0 && (
          <div className="mb-4">
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search Judge Book cards..."
              className="w-full md:max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm"
              aria-label="Search Judge Book cards"
            />
          </div>
        )}

        {loading ? (
          <div className="bg-white rounded-xl shadow-md p-6">Loading Judge Book...</div>
        ) : cards.length === 0 ? (
          <div className="bg-white rounded-xl shadow-md p-6">No Judge Book cards yet.</div>
        ) : filteredCards.length === 0 ? (
          <div className="bg-white rounded-xl shadow-md p-6">No Judge Book cards match your search.</div>
        ) : (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredCards.map((card) => (
              <Link
                key={card.id}
                href={`/judge-book/${card.id}`}
                className="bg-white rounded-2xl shadow-md border border-gray-200 p-5 hover:border-gray-300"
              >
                {editingCardId === card.id ? (
                  <div className="space-y-2" onClick={(event) => event.preventDefault()}>
                    <input
                      value={editDraft.prompt}
                      onChange={(event) => setEditDraft((prev) => ({ ...prev, prompt: event.target.value }))}
                      className="border rounded p-2 w-full"
                    />
                    <textarea
                      value={editDraft.answer}
                      onChange={(event) => setEditDraft((prev) => ({ ...prev, answer: event.target.value }))}
                      className="border rounded p-2 w-full min-h-[90px]"
                    />
                    <input
                      value={editDraft.imageUrl}
                      onChange={(event) => setEditDraft((prev) => ({ ...prev, imageUrl: event.target.value }))}
                      className="border rounded p-2 w-full"
                      placeholder="Optional image URL"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => void handleSaveEdit(card.id)}
                        className="px-3 py-1.5 rounded text-white text-sm font-semibold"
                        style={{ backgroundColor: "var(--primary-color)" }}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => {
                          setEditingCardId(null);
                          setEditDraft(emptyDraft());
                        }}
                        className="px-3 py-1.5 rounded border text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <h2 className="text-lg font-semibold mb-2 break-words">{card.prompt}</h2>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap break-words line-clamp-5">{card.answer || "No answer yet."}</p>
                    <p className="text-xs text-gray-500 mt-3">Updated {new Date(card.updatedAt || card.createdAt || 0).toLocaleString()}</p>
                    {canEdit && (
                      <div className="mt-3 flex gap-2" onClick={(event) => event.preventDefault()}>
                        <button
                          onClick={() => startEdit(card)}
                          className="px-3 py-1.5 rounded border text-sm"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => void handleDeleteCard(card.id)}
                          className="px-3 py-1.5 rounded border border-red-200 text-red-700 text-sm"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>

      {showCreateModal && canEdit && (
        <div className="fixed inset-0 bg-black/50 z-[120] flex items-start justify-center p-4 md:p-6 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[calc(100vh-2rem)] md:max-h-[calc(100vh-3rem)] flex flex-col overflow-hidden my-2">
            <div className="p-6 border-b flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold">Create Judge Book Cards</h2>
                <p className="text-sm text-gray-600">Single entry, multi-entry, or CSV import.</p>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="px-3 py-1 rounded border hover:bg-gray-50">Close</button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto">
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <h3 className="text-lg font-semibold mb-3">Question Creator</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  <input
                    value={singleDraft.prompt}
                    onChange={(event) => setSingleDraft((prev) => ({ ...prev, prompt: event.target.value }))}
                    className="border rounded p-2"
                    placeholder="Question/title"
                  />
                  <input
                    value={singleDraft.imageUrl}
                    onChange={(event) => setSingleDraft((prev) => ({ ...prev, imageUrl: event.target.value }))}
                    className="border rounded p-2"
                    placeholder="Optional image URL"
                  />
                </div>
                <textarea
                  value={singleDraft.answer}
                  onChange={(event) => setSingleDraft((prev) => ({ ...prev, answer: event.target.value }))}
                  className="border rounded p-2 w-full mt-3 min-h-[110px]"
                  placeholder="Answer/details"
                />
                <button
                  onClick={() => void createCards([singleDraft])}
                  disabled={saving}
                  className="mt-3 px-4 py-2 rounded text-white font-semibold disabled:opacity-60"
                  style={{ backgroundColor: "var(--primary-color)" }}
                >
                  {saving ? "Saving..." : "Add Card"}
                </button>
              </div>

              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <h3 className="text-lg font-semibold mb-2">Multi Question Creator</h3>
                <p className="text-sm text-gray-600 mb-2">One line per card: `question | answer | optional-image-url`</p>
                <textarea
                  value={multiDraft}
                  onChange={(event) => setMultiDraft(event.target.value)}
                  className="border rounded p-2 w-full min-h-[140px]"
                  placeholder="Member count | 34 students | https://...\nBuild season length | 8 weeks"
                />
                <button
                  onClick={() => void createCards(parseMultiDraft(multiDraft))}
                  disabled={saving}
                  className="mt-3 px-4 py-2 rounded text-white font-semibold disabled:opacity-60"
                  style={{ backgroundColor: "var(--primary-color)" }}
                >
                  {saving ? "Saving..." : "Add Multiple Cards"}
                </button>
              </div>

              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <h3 className="text-lg font-semibold mb-2">Import Through CSV</h3>
                <p className="text-sm text-gray-600 mb-2">Headers supported: `question/prompt/title`, `answer/response`, `image/imageUrl`.</p>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => void handleCsvImport(event.target.files?.[0] || null)}
                  disabled={saving}
                  className="block"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function JudgeBookPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <JudgeBookPageContent />
    </ProtectedRoute>
  );
}
