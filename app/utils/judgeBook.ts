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
};

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
