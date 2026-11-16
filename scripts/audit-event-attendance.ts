/**
 * READ-ONLY audit of one person's event attendance: why is this person listed for an event? It only calls `.get()`; it never writes, deletes
 * or updates anything, and it is NEVER run by the build or the tests (the tests use a fake store).
 *
 *   npx vite-node --config vitest.config.ts scripts/audit-event-attendance.ts --program=<frc|ftc> --uid=<uid> --team=<teamId> --confirm-project=<project id> [--season=<year>]
 *   npx vite-node --config vitest.config.ts scripts/audit-event-attendance.ts --help
 *
 * Credentials come ONLY from these environment variables, set deliberately in your own shell (this script never reads a file, and prints no secret):
 *   AUDIT_ADMIN_PROJECT_ID, AUDIT_ADMIN_CLIENT_EMAIL, AUDIT_ADMIN_PRIVATE_KEY
 * There is NO fallback to the app's FIREBASE_ADMIN_* names, on purpose: `vite-node` loads the repo's env files into the process, so a fallback would
 * silently reach the project in `.env.local`. `--confirm-project` must equal AUDIT_ADMIN_PROJECT_ID, so a run always names the project it reads.
 *
 * It prints, for the person: every event key whose attendance list contains them (raw and canonical), their entries grouped by canonical
 * event and source, events listed with no entries, entries with no attendance record, and which events fall outside the current season.
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, type Query } from "firebase-admin/firestore";
import { EVENT_CONFIG } from "../config/event";
import { programConfig } from "../config/programs";
import type { ProgramId } from "../config/programs/types";
import { auditEventAttendance, formatAuditReport } from "../lib/events/attendance-audit";
import { assertReadOnlyStore, loadAuditInput, type ReadOnlyStore } from "../lib/events/attendance-audit-reader";
import { currentSeasonFor } from "../lib/events/event-status";

const args = process.argv.slice(2);
const value = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const USAGE = "Usage: audit-event-attendance --program=<frc|ftc> --uid=<uid> --team=<teamId> --confirm-project=<project id> [--season=<year>]   (read-only; credentials from AUDIT_ADMIN_* environment variables)";

function need(name: string): string {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

async function main() {
  if (args.includes("--help") || args.length === 0) {
    console.log(USAGE);
    return;
  }
  const program = value("program") as ProgramId | undefined;
  const uid = value("uid");
  const teamId = value("team");
  if ((program !== "frc" && program !== "ftc") || !uid || !teamId) throw new Error(USAGE);

  const config = programConfig(program);
  const season = value("season") ? Number(value("season")) : currentSeasonFor(config.event.seasonKind, new Date(), EVENT_CONFIG.season);
  if (!Number.isInteger(season)) throw new Error("--season must be a whole year");

  const projectId = need("AUDIT_ADMIN_PROJECT_ID");
  if (value("confirm-project") !== projectId) throw new Error("--confirm-project must equal AUDIT_ADMIN_PROJECT_ID: name the project you mean to read.");
  const app = initializeApp({ credential: cert({ projectId, clientEmail: need("AUDIT_ADMIN_CLIENT_EMAIL"), privateKey: need("AUDIT_ADMIN_PRIVATE_KEY").replace(/\\n/g, "\n") }) }, "audit");
  const db = getFirestore(app);

  // Reads only: `.get()` on a document and on an equality query. The store has no other method.
  const store = {
    async getDoc(path: string) {
      const snap = await db.doc(path).get();
      return snap.exists ? (snap.data() as Record<string, unknown>) : null;
    },
    async getDocs(collectionPath: string, where: ReadonlyArray<readonly [string, string]>) {
      let q: Query = db.collection(collectionPath);
      for (const [field, v] of where) q = q.where(field, "==", v);
      return (await q.get()).docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
    },
  };
  assertReadOnlyStore(store);

  console.log(`Project ${projectId} (read-only). Program ${program}, season ${season}.\n`);
  const input = await loadAuditInput(store as ReadOnlyStore, { prefix: config.firestorePrefix, uid, teamId, shape: config.event.keyShape, season });
  console.log(formatAuditReport(auditEventAttendance(input)));
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
