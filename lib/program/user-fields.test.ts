import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ updateDoc: vi.fn(), doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join("/") })) }));
vi.mock("firebase/firestore", () => ({ updateDoc: h.updateDoc, doc: h.doc }));
vi.mock("@/lib/firebase/client", () => ({ db: { fake: true }, isFirebaseConfigured: () => true }));

import { saveUserFields, UserFieldsSaveError } from "@/lib/program/user-fields";
import type { ProgramData } from "@/lib/program/data";

const mockPort = () => {
  const updateFields = vi.fn().mockResolvedValue(undefined);
  return { updateFields, port: { profile: { subscribe: vi.fn(), update: vi.fn(), updateFields } } as unknown as Pick<ProgramData, "profile"> };
};

beforeEach(() => {
  h.updateDoc.mockReset();
  h.doc.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("saveUserFields", () => {
  it("the root program (no port): writes the root users/{uid} document exactly as before", async () => {
    h.updateDoc.mockResolvedValue(undefined);
    await saveUserFields(null, "u1", { glassLayerLevel: 1.2 });
    expect(h.doc).toHaveBeenCalledWith({ fake: true }, "users", "u1");
    expect(h.updateDoc).toHaveBeenCalledWith({ path: "users/u1" }, { glassLayerLevel: 1.2 });
  });

  it("a program with a port: goes through the port and never touches the root users document", async () => {
    const { port, updateFields } = mockPort();
    await saveUserFields(port, "u1", { workspaceFormWidth: 0.4 });
    expect(updateFields).toHaveBeenCalledWith("u1", { workspaceFormWidth: 0.4 });
    expect(h.updateDoc).not.toHaveBeenCalled();
    expect(h.doc).not.toHaveBeenCalled();
  });

  it("a failed root write is reported and thrown with text to show", async () => {
    h.updateDoc.mockRejectedValue(Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" }));
    await expect(saveUserFields(null, "u1", { glassLayerLevel: 1 }, "Couldn't save the glass shading")).rejects.toThrow(UserFieldsSaveError);
    await expect(saveUserFields(null, "u1", { glassLayerLevel: 1 }, "Couldn't save the glass shading")).rejects.toThrow(/Couldn't save the glass shading/);
  });

  it("a failed port write is thrown too (not swallowed)", async () => {
    const { port, updateFields } = mockPort();
    updateFields.mockRejectedValue(Object.assign(new Error("not found"), { code: "not-found" }));
    await expect(saveUserFields(port, "u1", { fcmTokens: ["t"] })).rejects.toThrow(UserFieldsSaveError);
  });
});
