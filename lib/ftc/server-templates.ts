import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { isProgramId } from "@/config/programs/types";
import { programPath } from "@/lib/firebase/paths";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { checksumMatches, type FormTemplate } from "@/lib/templates/build";
import type { Caller, RouteResult } from "@/lib/server/join-requests";

/**
 * `POST /api/ftc/templates`: the server side of form templates for an FTC account, over the Admin SDK and `programs/ftc/formTemplates` only. Nothing here
 * ever reads or writes a root collection.
 *
 * Body: `{ program: "ftc", action: "import", teamId, id }`. The program is REQUIRED in the body (never a cookie); any other KNOWN program is refused and so is anything else.
 * The caller is the verified ID token's uid (`withCaller`); this module then reads THEIR FTC user document and requires an admin or owner of the team in the request.
 *  - `import`: returns one of the team's own templates for the caller to copy. (The root route also counts a use of a PUBLIC template and serves other teams'
 *    public ones; FTC has no cross-team sharing, public templates or review, so a template of another team is refused.)
 * Writing, editing and deleting a private template are client writes under the FTC rules; publish, review and reports are not built for this program.
 */

const HOUR_MS = 60 * 60 * 1000;
const RATE_LIMIT_PER_HOUR = 120;
const fail = (status: number, code: string, error: string): RouteResult => ({ status, body: { ok: false, code, error } });

export type FtcTemplatesInput = { program?: unknown; action?: unknown; teamId?: unknown; id?: unknown };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function handleFtcTemplates(db: Firestore, caller: Caller, input: FtcTemplatesInput): Promise<RouteResult> {
  if (typeof input.program !== "string") return fail(400, "invalid_program", "Say which program this is for.");
  if (isProgramId(input.program) && input.program !== "ftc") return fail(400, "program_not_supported", "This route has no meaning for that program.");
  if (input.program !== "ftc") return fail(400, "invalid_program", "Unknown program.");
  if (input.action !== "import") return fail(400, "invalid_action", "Unknown action.");
  const teamId = typeof input.teamId === "string" && ID.test(input.teamId) ? input.teamId : null;
  if (!teamId) return fail(400, "invalid_team", "That is not a valid team.");
  const id = typeof input.id === "string" && ID.test(input.id) ? input.id : null;
  if (!id) return fail(400, "invalid_template", "That is not a valid template.");

  // Who is asking, from THEIR document (never from the request): an admin or owner of the team they name.
  const userSnap = await db.collection(programPath("ftc", "users")).doc(caller.uid).get();
  const user = userSnap.exists ? userSnap.data() : null;
  if (!isRecord(user) || user.teamId !== teamId || (user.isAdmin !== true && user.isOwner !== true)) return fail(403, "forbidden", "Only a team admin can do that.");

  const limit = await consumeRateLimit(db, `ftc-templates_${caller.uid}`, RATE_LIMIT_PER_HOUR, HOUR_MS);
  if (!limit.allowed) return fail(429, "rate_limited", "Too many requests. Try again later.");

  const snap = await db.collection(programPath("ftc", "formTemplates")).doc(id).get();
  if (!snap.exists) return fail(404, "not_found", "That template doesn't exist.");
  const data = snap.data() ?? {};
  if (data.ownerTeamId !== teamId) return fail(403, "forbidden", "That template isn't available to you.");
  const t = { ...data, id: snap.id } as FormTemplate;
  if (!isRecord(t.form) || !checksumMatches(t)) return fail(500, "damaged", "This template is damaged and can't be used.");
  return { status: 200, body: { ok: true, template: { id: t.id, version: t.version, name: t.name, description: t.description, tags: t.tags, form: t.form, checksum: t.checksum } } };
}
