// Text rules for the Analytics tables (Session 2). Pure, so they are unit tested.

const ELLIPSIS = "…";

/**
 * Shortens `text` to at most `max` characters by cutting the MIDDLE (`abcd…wxyz`), because the start and the end of an id are the parts people
 * recognise. Text that already fits is returned as is. `max` below 3 is treated as 3 (room for one character each side and the ellipsis).
 */
export function middleTruncate(text: string, max: number): string {
  const limit = Math.max(3, Math.floor(max));
  if (text.length <= limit) return text;
  const keep = limit - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return `${text.slice(0, head)}${ELLIPSIS}${tail > 0 ? text.slice(text.length - tail) : ""}`;
}

/** Column types that may grow past their base width to fill a wide table (free text); numbers, ids and badges keep their width. */
export function columnCanGrow(type: string, sticky: boolean | undefined): boolean {
  if (sticky) return false;
  return type === "comments" || type === "notes" || type === "scoutName" || type === "text" || type === "match";
}

/** Copies `text` to the clipboard; false when the browser refuses (no permission, insecure page), so the caller can say so instead of pretending. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
