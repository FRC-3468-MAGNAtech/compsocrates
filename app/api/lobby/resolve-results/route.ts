import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { requireUser } from "@/lib/server/require-user";
import { resolveLobbyResults } from "@/lib/lobby/resolve-results";
import { liveProgramStore, programFromBody } from "@/lib/server/live-program";

/**
 * P8: finalizes a Live Practice Lobby round — called by whichever open
 * client first notices every scouting player has submitted, by the host's
 * "End Scouting" button, or after the grace period past the video's own
 * runtime. Session-authed only (no CRON_SECRET route like P7's live mode
 * needs — a library match's official score is already known, so there's
 * nothing to wait on and no scheduled sweep required). Idempotent: see
 * lib/lobby/resolve-results.ts.
 *
 * The body's `program` (REQUIRED, no default) picks whose lobby is finalized; the caller must belong to the lobby's team IN THAT PROGRAM
 * (the program's own users collection), so a signed-in person of one program can never finalize the other's lobby.
 */
export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ ok: false, error: "Server isn't configured." }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { lobbyId?: string; program?: unknown } | null;
  const lobbyId = body?.lobbyId;
  if (!lobbyId) return NextResponse.json({ ok: false, error: "Missing lobbyId." }, { status: 400 });
  // REQUIRED, from the body: no default (missing, unknown or unsupported is a 400).
  const parsed = programFromBody(body?.program, "lobby");
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error, code: parsed.code }, { status: 400 });
  const program = parsed.program;
  const store = liveProgramStore(program);

  try {
    const lobbySnap = await db.collection(store.paths.lobbies).doc(lobbyId).get();
    if (!lobbySnap.exists) return NextResponse.json({ ok: false, error: "Lobby not found." }, { status: 404 });
    const userSnap = await db.collection(store.paths.users).doc(user.uid).get();
    if (!userSnap.exists || userSnap.data()?.teamId !== lobbySnap.data()?.teamId) {
      return NextResponse.json({ ok: false, error: "Not your team's lobby." }, { status: 403 });
    }

    const result = await resolveLobbyResults(db, lobbyId, program, store);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("resolve-results failed:", err);
    return NextResponse.json({ ok: false, error: "Internal error." }, { status: 500 });
  }
}
