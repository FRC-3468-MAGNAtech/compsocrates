import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ save: vi.fn(), update: vi.fn(), remove: vi.fn(), events: vi.fn(), other: vi.fn() }));
vi.mock("@/data/ftc/write", () => ({
  saveScoutEntry: (...args: unknown[]) => h.save(...args),
  updateScoutEntry: (...args: unknown[]) => h.update(...args),
  deleteScoutEntry: (...args: unknown[]) => h.remove(...args),
  setEventAttendance: (...args: unknown[]) => h.other(...args),
  updateMemberAccess: (...args: unknown[]) => h.other(...args),
  setActiveEvents: (...args: unknown[]) => h.events(...args),
  saveFormEntry: (...args: unknown[]) => h.other(...args),
  updateFormEntry: (...args: unknown[]) => h.other(...args),
  editOwnFormEntry: (...args: unknown[]) => h.other(...args),
  adminUpdateFormEntry: (...args: unknown[]) => h.other(...args),
  deleteFormEntry: (...args: unknown[]) => h.other(...args),
}));

import { deleteEntry, saveEntry, updateEntry, type SaveEntryInput } from "@/lib/scout-entries";
import { setActiveEvent, setActiveEvents } from "@/lib/team";
import { setEventAttendance } from "@/lib/event-attendance";
import { updateMemberAccess } from "@/lib/team-members";
import { adminUpdateFormEntry, deleteFormEntry, editOwnFormEntry, saveFormEntry, updateFormEntry } from "@/lib/form-entries";

const input: SaveEntryInput = {
  scoutName: "Ada",
  eventCode: "EV1",
  matchType: "Qualification",
  matchNumber: 3,
  teamNumber: 100,
  formId: "biobuzz",
  formVersion: 1,
  values: { autoLeave: true },
  score: { auto: 3, teleop: 0, endgame: 0, total: 3 },
  comments: "",
};

// (braces matter: a function returned from beforeEach is run as a teardown, and `mockReset()` returns the mock itself)
beforeEach(() => {
  h.save.mockReset();
  h.update.mockReset();
  h.remove.mockReset();
  h.events.mockReset();
  h.other.mockReset();
});

describe("saveEntry and the program", () => {
  it("writes through the program's own data port when the program has one", async () => {
    h.save.mockResolvedValue(undefined);
    await saveEntry("team-a", "uid-ada", input, "ftc");
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.save).toHaveBeenCalledWith("team-a", "uid-ada", input);
  });

  it("surfaces a failed save to the caller (the scout page puts the notes back and shows the error)", async () => {
    h.save.mockRejectedValue(new Error("denied"));
    await expect(saveEntry("team-a", "uid-ada", input, "ftc")).rejects.toThrow("denied");
  });

  it("the default program never touches the program port", async () => {
    // its own write (the root `scouting` collection) refuses this entry here: no Firestore client in a unit test, and a form it cannot store
    await saveEntry("team-a", "uid-ada", input).catch(() => undefined);
    expect(h.save).not.toHaveBeenCalled();
  });
});

describe("updateEntry and deleteEntry and the program", () => {
  it("write through the program's own data port when the program has one", async () => {
    h.update.mockResolvedValue(undefined);
    h.remove.mockResolvedValue(undefined);
    await updateEntry("e1", { excluded: true }, {}, "ftc");
    await deleteEntry("e1", "ftc");
    expect(h.update).toHaveBeenCalledWith("e1", { excluded: true });
    expect(h.remove).toHaveBeenCalledWith("e1");
  });

  it("the default program never touches the program port", async () => {
    await updateEntry("e1", { excluded: true }).catch(() => undefined);
    await deleteEntry("e1").catch(() => undefined);
    expect(h.update).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
  });
});

describe("setActiveEvents and the program", () => {
  const state = { events: [], primaryCode: null };

  it("writes through the program's own data port when the program has one, and the single-event form passes the program along", async () => {
    h.events.mockResolvedValue(undefined);
    await setActiveEvents("team-a", state, "ftc");
    await setActiveEvent("team-a", null, "ftc");
    expect(h.events).toHaveBeenCalledTimes(2);
    expect(h.events).toHaveBeenCalledWith("team-a", state);
  });

  it("the default program never touches the program port", async () => {
    await setActiveEvents("team-a", state).catch(() => undefined);
    await setActiveEvent("team-a", null).catch(() => undefined);
    expect(h.events).not.toHaveBeenCalled();
  });
});

describe("form entry writers and the program", () => {
  const entryInput = { scoutName: "Pia", formId: "pit-scout-v1", formVersion: 1, formType: "pit-scout", eventCode: "EV1", values: {} } as const;
  const actor = { teamId: "team-a", uid: "u1", name: "Pia" };
  const own = { id: "fe1", formId: "pit-scout-v1", eventCode: "EV1", teamNumber: 1, values: {}, stickyNotes: [] };

  it("write through the program's own data port when the program has one", async () => {
    h.other.mockResolvedValue("new-id");
    expect(await saveFormEntry("team-a", "u1", entryInput, "ftc")).toBe("new-id");
    await updateFormEntry("fe1", { values: {} }, "ftc");
    await editOwnFormEntry(actor, own, { values: {}, stickyNotes: [] }, "ftc");
    await adminUpdateFormEntry("fe1", { excluded: true }, "ftc");
    await deleteFormEntry("fe1", "ftc");
    expect(h.other).toHaveBeenCalledTimes(5);
    expect(h.other).toHaveBeenCalledWith("team-a", "u1", entryInput);
    expect(h.other).toHaveBeenCalledWith("fe1");
  });

  it("a handle that is an entry names its id", async () => {
    h.other.mockResolvedValue(undefined);
    await deleteFormEntry({ id: "fe9", formType: "pit-scout", legacy: undefined }, "ftc");
    expect(h.other).toHaveBeenCalledWith("fe9");
  });

  it("the default program never touches the program port", async () => {
    await saveFormEntry("team-a", "u1", entryInput).catch(() => undefined);
    await deleteFormEntry("fe1").catch(() => undefined);
    await adminUpdateFormEntry("fe1", { excluded: true }).catch(() => undefined);
    expect(h.other).not.toHaveBeenCalled();
  });
});

describe("people writers and the program", () => {
  const actor = { teamId: "team-a", uid: "u1", name: "Ada" };
  const member = { uid: "u2", name: "Grace", primaryRole: "match-scout" as const, secondaryRoles: [], isAdmin: false };

  it("write through the program's own data port when the program has one", async () => {
    h.other.mockResolvedValue(undefined);
    await updateMemberAccess(actor, member, { isAdmin: true }, "ftc");
    await setEventAttendance("team-a", "EV1", ["u1"], "ftc");
    expect(h.other).toHaveBeenCalledWith(actor, member, { isAdmin: true });
    expect(h.other).toHaveBeenCalledWith("team-a", "EV1", ["u1"]);
  });

  it("an empty role change writes nothing, anywhere", async () => {
    await updateMemberAccess(actor, member, {}, "ftc");
    expect(h.other).not.toHaveBeenCalled();
  });

  it("the default program never touches the program port", async () => {
    await updateMemberAccess(actor, member, { isAdmin: true }).catch(() => undefined);
    await setEventAttendance("team-a", "EV1", ["u1"]).catch(() => undefined);
    expect(h.other).not.toHaveBeenCalled();
  });
});
