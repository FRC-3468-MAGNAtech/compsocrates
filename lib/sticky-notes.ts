import type { StickyNote } from "@/lib/forms/types";

// P28: the sticky notes behind the side panel: free-form note cards kept in the form's state (and saved as `stickyNotes[]` on the entry). Pure.

export const MAX_NOTES = 50;
export const MAX_NOTE_LENGTH = 1000;

/** A few theme-safe colours: each is a translucent tint with the normal foreground ink on top, so the text stays legible in every theme. */
export const NOTE_COLORS = [
  { id: "yellow", label: "Yellow", className: "bg-amber-300/25 border-amber-300/50" },
  { id: "blue", label: "Blue", className: "bg-sky-400/20 border-sky-300/50" },
  { id: "green", label: "Green", className: "bg-emerald-400/20 border-emerald-300/50" },
  { id: "pink", label: "Pink", className: "bg-pink-400/20 border-pink-300/50" },
] as const;

export type NoteColorId = (typeof NOTE_COLORS)[number]["id"];
export const DEFAULT_NOTE_COLOR: NoteColorId = "yellow";
export const noteColorClass = (color: string): string => (NOTE_COLORS.find((c) => c.id === color) ?? NOTE_COLORS[0]).className;

let counter = 0;
/** A new, empty note (the panel opens it for typing). The id is random enough to be unique within an entry. */
export function newNote(color: string = DEFAULT_NOTE_COLOR, now: number = Date.now(), rand: () => number = Math.random): StickyNote {
  counter += 1;
  return { id: `n${now.toString(36)}${Math.floor(rand() * 1e9).toString(36)}${counter}`, text: "", color: NOTE_COLORS.some((c) => c.id === color) ? color : DEFAULT_NOTE_COLOR, createdAt: now };
}

/** Pinned notes first, then the rest; newest first inside each. Stable for equal times. */
export function sortNotes(notes: readonly StickyNote[]): StickyNote[] {
  return notes
    .map((n, i) => ({ n, i }))
    .sort((a, b) => Number(!!b.n.pinned) - Number(!!a.n.pinned) || b.n.createdAt - a.n.createdAt || a.i - b.i)
    .map((x) => x.n);
}

/** Adds a note (at most `MAX_NOTES`): unchanged when full. */
export const addNote = (notes: readonly StickyNote[], note: StickyNote): StickyNote[] => (notes.length >= MAX_NOTES ? [...notes] : [...notes, note]);

export const editNote = (notes: readonly StickyNote[], id: string, text: string): StickyNote[] => notes.map((n) => (n.id === id ? { ...n, text: text.slice(0, MAX_NOTE_LENGTH) } : n));
export const deleteNote = (notes: readonly StickyNote[], id: string): StickyNote[] => notes.filter((n) => n.id !== id);
export const setNoteColor = (notes: readonly StickyNote[], id: string, color: string): StickyNote[] => notes.map((n) => (n.id === id && NOTE_COLORS.some((c) => c.id === color) ? { ...n, color } : n));
export const togglePin = (notes: readonly StickyNote[], id: string): StickyNote[] =>
  notes.map((n) => {
    if (n.id !== id) return n;
    const { pinned, ...rest } = n;
    return pinned ? rest : { ...rest, pinned: true };
  });

/** How many notes have text (the badge on the tab). */
export const noteCount = (notes: readonly StickyNote[]): number => notes.filter((n) => n.text.trim() !== "").length;

/** The notes as they are saved with an entry: blank ones dropped, text trimmed, newest-pinned order kept. */
export const notesForSave = (notes: readonly StickyNote[]): StickyNote[] => sortNotes(notes).filter((n) => n.text.trim() !== "").map((n) => ({ ...n, text: n.text.trim() }));

/** "3:42 PM" for a note's timestamp. */
export function formatNoteTime(ms: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(new Date(ms));
}

/** Panel width limits (px): never too narrow to read, never most of the screen. */
export const PANEL_MIN_PX = 240;
export const PANEL_MAX_PX = 520;
export const PANEL_DEFAULT_PX = 320;
export const clampPanelWidth = (px: number): number => (Number.isFinite(px) ? Math.min(PANEL_MAX_PX, Math.max(PANEL_MIN_PX, Math.round(px))) : PANEL_DEFAULT_PX);

// The form pages show ONE big notes box, not a stack of cards (analytics shows the same: one block of text). It is stored as a single entry of `stickyNotes[]`
// so the saved shape and old entries are unchanged.

/** The most the single notes box holds. */
export const MAX_NOTES_BOX_LENGTH = 5000;

/** The box's text: the one note's text; an older draft or entry with several notes shows them oldest first, separated by a blank line. */
export const notesBoxText = (notes: readonly StickyNote[]): string =>
  [...notes]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((n) => n.text)
    .filter((t) => t !== "")
    .join("\n\n");

/** The notes after the box's text becomes `text`: one note (the oldest one's id, colour and time are kept, any others are folded into it), or none for empty text. */
export function setNotesBoxText(notes: readonly StickyNote[], text: string, now: number = Date.now()): StickyNote[] {
  const next = text.slice(0, MAX_NOTES_BOX_LENGTH);
  const first = [...notes].sort((a, b) => a.createdAt - b.createdAt)[0];
  if (!first) return next === "" ? [] : [{ ...newNote(DEFAULT_NOTE_COLOR, now), text: next }];
  return [{ ...first, text: next }];
}
