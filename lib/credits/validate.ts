import {
  MAX_DESCRIPTION,
  MAX_ENTRIES,
  MAX_NAME,
  MAX_SECTION_DESCRIPTION,
  MAX_SECTION_TITLE,
  MAX_SECTIONS,
  MAX_TOTAL_ENTRIES,
  MAX_URL,
  renumber,
  type CreditEntry,
  type CreditSection,
} from "@/lib/credits/ops";
import { findUnsafeLinks, isSafeHttpsUrl } from "@/lib/rich-text";

// The strict check of a whole credits document (Session 7), used by the server before it stores anything. `sanitizeSections` (ops.ts) is the
// forgiving READ side; this is the WRITE side: anything wrong is an error, nothing is silently repaired except trimming and numbering.

export type CreditsParse = { ok: true; sections: CreditSection[] } | { ok: false; error: string };

const ID = /^[A-Za-z0-9_-]{1,60}$/;
const HTML_LIKE = /<\s*\/?\s*[a-zA-Z!?]/;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function textProblem(label: string, text: string, max: number): string | null {
  if (text.length > max) return `${label} is over ${max} characters.`;
  if (HTML_LIKE.test(text)) return `${label}: HTML isn't allowed.`;
  if (CONTROL.test(text)) return `${label} has control characters.`;
  if (findUnsafeLinks(text).length > 0) return `${label}: links must start with https://.`;
  return null;
}

function urlOrNull(label: string, v: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (v === null || v === undefined || v === "") return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, error: `${label} must be a link.` };
  const t = v.trim();
  if (t.length > MAX_URL) return { ok: false, error: `${label} is over ${MAX_URL} characters.` };
  if (!isSafeHttpsUrl(t)) return { ok: false, error: `${label} must start with https://.` };
  return { ok: true, value: t };
}

/** Validates the sections the owner saves. Returns the clean list (numbered, trimmed, unknown keys dropped) or the first problem. */
export function parseCreditsInput(raw: unknown): CreditsParse {
  if (!Array.isArray(raw)) return { ok: false, error: "The credits must be a list of sections." };
  if (raw.length > MAX_SECTIONS) return { ok: false, error: `At most ${MAX_SECTIONS} sections.` };
  const sectionIds = new Set<string>();
  const entryIds = new Set<string>();
  const sections: CreditSection[] = [];
  let total = 0;

  for (const [si, rs] of raw.entries()) {
    const where = `Section ${si + 1}`;
    if (!rs || typeof rs !== "object" || Array.isArray(rs)) return { ok: false, error: `${where} isn't valid.` };
    const s = rs as Record<string, unknown>;
    if (typeof s.id !== "string" || !ID.test(s.id)) return { ok: false, error: `${where} has no valid id.` };
    if (sectionIds.has(s.id)) return { ok: false, error: `${where} repeats an id.` };
    sectionIds.add(s.id);
    const title = typeof s.title === "string" ? s.title.trim() : "";
    if (title === "") return { ok: false, error: `${where} needs a title.` };
    const titleProblem = textProblem(`${where} title`, title, MAX_SECTION_TITLE);
    if (titleProblem) return { ok: false, error: titleProblem };
    const description = typeof s.description === "string" ? s.description.trim() : "";
    if (s.description !== undefined && s.description !== null && typeof s.description !== "string") return { ok: false, error: `${where} description must be text.` };
    if (description) {
      const p = textProblem(`${where} description`, description, MAX_SECTION_DESCRIPTION);
      if (p) return { ok: false, error: p };
    }
    if (!Array.isArray(s.entries)) return { ok: false, error: `${where} needs a list of entries.` };
    if (s.entries.length > MAX_ENTRIES) return { ok: false, error: `${where} has more than ${MAX_ENTRIES} entries.` };

    const entries: CreditEntry[] = [];
    for (const [ei, re] of s.entries.entries()) {
      const at = `${where}, entry ${ei + 1}`;
      if (!re || typeof re !== "object" || Array.isArray(re)) return { ok: false, error: `${at} isn't valid.` };
      const e = re as Record<string, unknown>;
      if (typeof e.id !== "string" || !ID.test(e.id)) return { ok: false, error: `${at} has no valid id.` };
      if (entryIds.has(e.id)) return { ok: false, error: `${at} repeats an id.` };
      entryIds.add(e.id);
      const name = typeof e.name === "string" ? e.name.trim() : "";
      if (name === "") return { ok: false, error: `${at} needs a name.` };
      const nameProblem = textProblem(`${at} name`, name, MAX_NAME);
      if (nameProblem) return { ok: false, error: nameProblem };
      if (e.description !== undefined && e.description !== null && typeof e.description !== "string") return { ok: false, error: `${at} text must be text.` };
      const text = typeof e.description === "string" ? e.description.trim() : "";
      if (text) {
        const p = textProblem(`${at} text`, text, MAX_DESCRIPTION);
        if (p) return { ok: false, error: p };
      }
      const link = urlOrNull(`${at} link`, e.link);
      if (!link.ok) return link;
      const image = urlOrNull(`${at} image`, e.imageUrl);
      if (!image.ok) return image;
      entries.push({ id: e.id, name, description: text, link: link.value, imageUrl: image.value });
      total += 1;
    }
    sections.push({ id: s.id, title, ...(description ? { description } : {}), order: si, entries });
  }
  if (total > MAX_TOTAL_ENTRIES) return { ok: false, error: `At most ${MAX_TOTAL_ENTRIES} entries in all.` };
  return { ok: true, sections: renumber(sections) };
}
