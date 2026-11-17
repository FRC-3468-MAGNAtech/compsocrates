import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { DEFAULT_PROGRAM, PROGRAM_IDS, type ProgramId } from "@/config/programs/types";
import { firebaseAdminProblem, getAdminFirestore, getAdminMessaging } from "@/lib/firebase/admin";
import { cronSecret } from "@/lib/server/env";
import { liveDataWarnings } from "@/lib/server/live-env";
import { resolvePendingLiveMatches } from "@/lib/live/resolve-pending";

/**
 * P7: the score-ready poller. Call every 2-5 minutes from a free external
 * scheduler (cron-job.org, a GitHub Actions schedule, ...) sending
 * `Authorization: Bearer <CRON_SECRET>` — Vercel's own Hobby-plan cron only
 * runs once a day at an inexact time, nowhere close to fast enough; see
 * docs/ENVIRONMENT.md and `vercel.json` for the daily
 * fallback entry. Unverified in this sandbox — no real live event or
 * scheduler to run it against; the logic
 * itself (`lib/live/resolve-pending.ts`) is unit-tested indirectly through
 * its pure building blocks (`resolveLiveAllianceScoring`,
 * `isAllianceReadyToNotify`).
 *
 * Failures say what to fix: no CRON_SECRET set is a 503 naming it (the poller stays off), a wrong secret is a 401, an
 * unconfigured Admin SDK is a 503 naming FIREBASE_ADMIN_*.
 */
function bearerMatches(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  const secret = cronSecret();
  if (!secret) {
    return NextResponse.json({ ok: false, error: "The poller is off: CRON_SECRET is not configured. Set CRON_SECRET and send it as a Bearer token." }, { status: 503 });
  }
  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ ok: false, error: firebaseAdminProblem() ?? "Server isn't configured." }, { status: 503 });
  const messaging = getAdminMessaging();

  // One sweep per program (each has its own sessions, entries and event API). A program that fails is reported and does not stop the others.
  const perProgram: Partial<Record<ProgramId, { checked: number; resolved: number } | { error: string }>> = {};
  const warnings: string[] = [];
  let checked = 0;
  let resolved = 0;
  for (const program of PROGRAM_IDS) {
    try {
      const result = await resolvePendingLiveMatches(db, messaging, undefined, program);
      perProgram[program] = result;
      checked += result.checked;
      resolved += result.resolved;
      // A key problem only matters while there is something pending that needs the program's data.
      if (result.checked > 0 || program === DEFAULT_PROGRAM) warnings.push(...liveDataWarnings(program));
    } catch (err) {
      console.error(`poll-live-scores failed (${program}):`, err);
      perProgram[program] = { error: "Internal error." };
    }
  }
  // The default program's sweep failing is still a 500, as before (the other program's sweep has run either way).
  if ("error" in (perProgram[DEFAULT_PROGRAM] ?? {})) return NextResponse.json({ ok: false, error: "Internal error." }, { status: 500 });
  return NextResponse.json({ ok: true, checked, resolved, programs: perProgram, ...(warnings.length > 0 ? { warnings } : {}) });
}
