import { handleFtcTemplates } from "@/lib/ftc/server-templates";
import { readJsonBody, withCaller } from "@/lib/server/route-helpers";

/**
 * Form templates, server side, for an FTC account (the root `/api/templates` route only knows the default program's teams). Admin or owner of the named team
 * only; see lib/ftc/server-templates.ts. Body: `{ program: "ftc", action: "import", teamId, id }`.
 */
export const maxDuration = 30;

export async function POST(request: Request) {
  const body = await readJsonBody(request);
  return withCaller(request, (db, caller) => handleFtcTemplates(db, caller, { program: body.program, action: body.action, teamId: body.teamId, id: body.id }));
}
