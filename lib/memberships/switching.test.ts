import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("@/lib/firebase/client", () => ({ db: {} }));
vi.mock("@/lib/firebase/metered", () => ({ getDoc: vi.fn() }));
vi.mock("@/lib/program/context", () => ({ useProgram: () => "frc" }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: null, profile: null }) }));

import { CONFIRM_TRIES, confirmPointer } from "@/lib/memberships/switching";

describe("confirmPointer (the hold across programs ends only when the other program's profile shows the team)", () => {
  const noSleep = async () => {};
  it("is true as soon as the pointer shows the target, with one read", async () => {
    const read = vi.fn().mockResolvedValue("T2");
    expect(await confirmPointer(read, "T2", 3, 0, noSleep)).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("waits through stale answers and failed reads, then gives up after the tries (the caller reports it and does not navigate)", async () => {
    const read = vi.fn().mockResolvedValueOnce("OLD").mockRejectedValueOnce(new Error("offline")).mockResolvedValue("T2");
    expect(await confirmPointer(read, "T2", 3, 0, noSleep)).toBe(true);
    const stuck = vi.fn().mockResolvedValue("OLD");
    expect(await confirmPointer(stuck, "T2", CONFIRM_TRIES, 0, noSleep)).toBe(false);
    expect(stuck).toHaveBeenCalledTimes(CONFIRM_TRIES);
  });
});
