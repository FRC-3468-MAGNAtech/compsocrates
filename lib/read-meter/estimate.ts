"use client";

// How many documents a heavy admin tool is about to read, counted with Firestore COUNT queries (about one read per 1,000 index entries per query, so a few reads
// in all) and shown in a confirmation before the tool runs. The program only supplies the collection names (`ProgramConfig.readEstimate`).
import { PROGRAMS } from "@/config/programs";
import type { ProgramConfig, ProgramId } from "@/config/programs/types";
import { collection, getCountFromServer, query, where } from "@/lib/firebase/metered";
import { db } from "@/lib/firebase/client";
import { programPath } from "@/lib/firebase/paths";
import { describeEstimate } from "@/lib/read-meter/model";

export type HeavyTool = "backups" | "rescore" | "sessions" | "audit-log" | "accuracy-recompute" | "csv-import";

type Part = { key: keyof ProgramConfig["readEstimate"]; scope: "team" | "all"; label: string };

/** What each tool reads (pure data, tested): the team's own collections and the whole shared match library. */
export const TOOL_PARTS: Record<HeavyTool, Part[]> = {
  backups: [
    { key: "entries", scope: "team", label: "entries" },
    { key: "sessions", scope: "team", label: "practice sessions" },
    { key: "members", scope: "team", label: "members" },
    { key: "auditLog", scope: "team", label: "audit entries" },
    { key: "library", scope: "all", label: "library matches" },
  ],
  rescore: [
    { key: "entries", scope: "team", label: "entries" },
    { key: "sessions", scope: "team", label: "practice sessions" },
    { key: "library", scope: "all", label: "library matches" },
  ],
  sessions: [
    { key: "sessions", scope: "team", label: "practice sessions" },
    { key: "members", scope: "team", label: "members" },
  ],
  "audit-log": [{ key: "auditLog", scope: "team", label: "audit entries" }],
  "accuracy-recompute": [
    { key: "entries", scope: "team", label: "entries" },
    { key: "sessions", scope: "team", label: "practice sessions" },
  ],
  "csv-import": [{ key: "entries", scope: "team", label: "entries (read again by the accuracy recalculation that follows an import)" }],
};

export type Estimate = { total: number; text: string };

export async function estimateTool(tool: HeavyTool, program: ProgramId, teamId: string): Promise<Estimate | null> {
  const names = PROGRAMS[program].readEstimate;
  try {
    const counted = await Promise.all(
      TOOL_PARTS[tool].map(async (part) => {
        const ref = collection(db, programPath(program, names[part.key]));
        const snap = await getCountFromServer(part.scope === "team" ? query(ref, where("teamId", "==", teamId)) : ref);
        return { label: part.label, docs: snap.data().count };
      })
    );
    return describeEstimate(counted);
  } catch (err) {
    console.warn("read estimate unavailable:", err instanceof Error ? err.message : "unknown error");
    return null; // the confirmation then says the size is unknown
  }
}
