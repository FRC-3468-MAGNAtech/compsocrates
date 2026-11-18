import { describe, expect, it } from "vitest";
import { DELETION_TEXT, friendlyDeletionError } from "@/lib/deletion/strings";

const dialogText = [DELETION_TEXT.sectionIntro, ...DELETION_TEXT.kept, ...DELETION_TEXT.deleted, DELETION_TEXT.irreversible, DELETION_TEXT.policy, DELETION_TEXT.inProgress, DELETION_TEXT.signInBlocked].join(" ");

describe("the account deletion words", () => {
  it("say what is kept, what is deleted, that it cannot be undone, and that the team's policy applies", () => {
    expect(DELETION_TEXT.kept.join(" ")).toMatch(/Deleted Account/);
    expect(DELETION_TEXT.deleted.join(" ")).toMatch(/email/i);
    expect(DELETION_TEXT.irreversible).toMatch(/cannot be undone/);
    expect(DELETION_TEXT.policy).toBe("Your team's policy applies to what a team keeps.");
  });

  it("make no legal claim", () => {
    expect(dialogText).not.toMatch(/\b(law|legal|legally|gdpr|coppa|ferpa|privacy act|regulation|comply|compliant|rights)\b/i);
  });

  it("the sign-in notice for a disabled account is the one asked for", () => {
    expect(DELETION_TEXT.signInBlocked).toBe("This account is being deleted.");
  });

  it("every refusal code the server uses has a plain message, and an unknown one falls back", () => {
    for (const code of ["last_admin", "platform_owner", "deletion_in_progress", "reauth_required", "not_confirmed", "rate_limited", "quota_exceeded", "timeout"]) {
      expect(friendlyDeletionError(code).length).toBeGreaterThan(10);
    }
    expect(friendlyDeletionError("nope")).toBe(DELETION_TEXT.generic);
    expect(friendlyDeletionError("nope", "Server said this")).toBe("Server said this");
  });
});
