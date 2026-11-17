import { describe, expect, it } from "vitest";
import type { StickyNote } from "@/lib/forms/types";
import { MAX_NOTES, MAX_NOTES_BOX_LENGTH, MAX_NOTE_LENGTH, notesBoxText, setNotesBoxText, PANEL_DEFAULT_PX, PANEL_MAX_PX, PANEL_MIN_PX, addNote, clampPanelWidth, deleteNote, editNote, newNote, noteColorClass, noteCount, notesForSave, setNoteColor, sortNotes, togglePin } from "./sticky-notes";

const note = (id: string, createdAt: number, over: Partial<StickyNote> = {}): StickyNote => ({ id, text: id, color: "yellow", createdAt, ...over });

describe("sticky notes", () => {
  it("makes unique, empty notes in a valid colour", () => {
    const a = newNote("blue", 1000, () => 0.5);
    const b = newNote("blue", 1000, () => 0.5);
    expect(a.id).not.toBe(b.id);
    expect(a).toMatchObject({ text: "", color: "blue", createdAt: 1000 });
    expect(newNote("neon").color).toBe("yellow");
  });

  it("adds, edits, deletes and recolours", () => {
    let notes = addNote([], note("a", 1));
    notes = addNote(notes, note("b", 2));
    expect(notes.map((n) => n.id)).toEqual(["a", "b"]);
    notes = editNote(notes, "a", "hello");
    expect(notes[0].text).toBe("hello");
    expect(editNote(notes, "a", "x".repeat(MAX_NOTE_LENGTH + 50))[0].text).toHaveLength(MAX_NOTE_LENGTH);
    notes = setNoteColor(notes, "b", "green");
    expect(notes[1].color).toBe("green");
    expect(setNoteColor(notes, "b", "neon")[1].color).toBe("green");
    notes = deleteNote(notes, "a");
    expect(notes.map((n) => n.id)).toEqual(["b"]);
    expect(deleteNote(notes, "nope")).toEqual(notes);
  });

  it("stops at the maximum", () => {
    const full = Array.from({ length: MAX_NOTES }, (_, i) => note(`n${i}`, i));
    expect(addNote(full, note("extra", 99))).toHaveLength(MAX_NOTES);
  });

  it("pins to the top, newest first inside each group, and unpins", () => {
    let notes = [note("old", 1), note("mid", 2), note("new", 3)];
    expect(sortNotes(notes).map((n) => n.id)).toEqual(["new", "mid", "old"]);
    notes = togglePin(notes, "old");
    expect(sortNotes(notes).map((n) => n.id)).toEqual(["old", "new", "mid"]);
    expect(notes.find((n) => n.id === "old")?.pinned).toBe(true);
    notes = togglePin(notes, "old");
    expect(notes.find((n) => n.id === "old")).not.toHaveProperty("pinned");
    expect(sortNotes(notes).map((n) => n.id)).toEqual(["new", "mid", "old"]);
  });

  it("counts only notes with text, and saves them trimmed and without blanks", () => {
    const notes = [note("a", 1, { text: "  slow auto  " }), note("b", 2, { text: "   " }), note("c", 3, { text: "great defense", pinned: true })];
    expect(noteCount(notes)).toBe(2);
    expect(notesForSave(notes).map((n) => [n.id, n.text])).toEqual([
      ["c", "great defense"],
      ["a", "slow auto"],
    ]);
  });

  it("knows its colours and clamps the panel width", () => {
    expect(noteColorClass("blue")).toContain("sky");
    expect(noteColorClass("???")).toContain("amber");
    expect(clampPanelWidth(10)).toBe(PANEL_MIN_PX);
    expect(clampPanelWidth(5000)).toBe(PANEL_MAX_PX);
    expect(clampPanelWidth(333.4)).toBe(333);
    expect(clampPanelWidth(Number.NaN)).toBe(PANEL_DEFAULT_PX);
  });
});

describe("the single notes box", () => {
  const n = (id: string, text: string, createdAt: number) => ({ id, text, color: "yellow", createdAt });

  it("starts empty, and typing creates exactly one note", () => {
    expect(notesBoxText([])).toBe("");
    expect(setNotesBoxText([], "", 5)).toEqual([]);
    const made = setNotesBoxText([], "hello", 5);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ text: "hello", createdAt: 5 });
  });

  it("keeps editing the same note, and survives a round trip (layout switch or draft restore)", () => {
    const one = setNotesBoxText([], "a", 5);
    const two = setNotesBoxText(one, "ab", 9);
    expect(two).toHaveLength(1);
    expect(two[0].id).toBe(one[0].id);
    expect(notesBoxText(two)).toBe("ab");
  });

  it("folds an older multi-note draft into the one box, oldest first", () => {
    const old = [n("b", "second", 2), n("a", "first", 1)];
    expect(notesBoxText(old)).toBe("first\n\nsecond");
    const folded = setNotesBoxText(old, "first\n\nsecond!", 9);
    expect(folded).toEqual([{ id: "a", text: "first\n\nsecond!", color: "yellow", createdAt: 1 }]);
  });

  it("caps the length", () => {
    expect(setNotesBoxText([], "x".repeat(MAX_NOTES_BOX_LENGTH + 10), 1)[0].text).toHaveLength(MAX_NOTES_BOX_LENGTH);
  });
});
