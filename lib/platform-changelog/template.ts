import type { EntryInput } from "@/lib/platform-changelog/model";
import { v2EntryInput } from "@/lib/platform-changelog/v2-entry";

// The "Start from the v2.0.0 template" draft. It FILLS THE EDITOR FORM; nothing is saved until the owner presses Save. The wording, the tags and the
// version live in ONE module (`v2-entry.ts`), shared with the seed script, so the template and the seeded draft cannot differ.

export { V2_VERSION, v2Title } from "@/lib/platform-changelog/v2-entry";

/** The template as editor input: the approved entry, dated `todayIso`. */
export const v2Template = (todayIso: string): EntryInput => v2EntryInput(todayIso);
