import { FormAccessOverrides, RoleAwareUser, getUserRoles } from "@/app/utils/roles";

export type JudgeBookCard = {
  id: string;
  teamId: string;
  prompt: string;
  answer: string;
  imageUrl?: string;
  createdAt: number;
  updatedAt: number;
  createdByUid: string;
  createdByName: string;
  updatedByUid: string;
  updatedByName: string;
  source?: "team-doc" | "legacy-collection";
};

export function normalizeJudgeBookCard(value: unknown): JudgeBookCard | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = String(row.id || "").trim();
  const prompt = String(row.prompt || "").trim();
  if (!id || !prompt) return null;
  const createdAt = Number(row.createdAt || 0);
  const updatedAt = Number(row.updatedAt || 0) || createdAt;
  return {
    id,
    teamId: String(row.teamId || "").trim(),
    prompt,
    answer: String(row.answer || ""),
    imageUrl: String(row.imageUrl || ""),
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now(),
    createdByUid: String(row.createdByUid || ""),
    createdByName: String(row.createdByName || ""),
    updatedByUid: String(row.updatedByUid || ""),
    updatedByName: String(row.updatedByName || ""),
    source: "team-doc",
  };
}

export function sortJudgeBookCards(cards: JudgeBookCard[]): JudgeBookCard[] {
  return [...cards].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function canEditJudgeBook(
  user: RoleAwareUser | null | undefined,
  formAccessOverrides?: FormAccessOverrides
): boolean {
  if (!user) return false;
  if (user.isTeamAdmin) return true;
  if (String(user.role || "").trim().toLowerCase() === "coach") return true;
  const roles = getUserRoles(user);
  if (roles.includes("team-coach") || roles.includes("judge-awards")) return true;
  const overrides = formAccessOverrides?.["judge-book-edit"] || [];
  return Boolean(user.uid && overrides.includes(user.uid));
}
