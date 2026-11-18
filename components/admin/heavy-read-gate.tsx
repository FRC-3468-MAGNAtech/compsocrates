"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { useAuth } from "@/lib/auth";
import { useProgram } from "@/lib/program/context";
import { DAILY_FREE_READS } from "@/lib/read-meter/model";
import { estimateTool, type Estimate, type HeavyTool } from "@/lib/read-meter/estimate";

const UNKNOWN = `The size could not be counted. These tools can read thousands of documents, and the free plan allows ${DAILY_FREE_READS.toLocaleString("en-US")} reads a day for everyone.`;

// Tools already confirmed in this page load (a reload asks again): opening the tab twice does not ask twice.
const confirmed = new Set<string>();

/**
 * Holds a heavy admin tool (Backups, Rescore, Sessions, Audit Log) behind a confirmation that says roughly how many documents it will read, counted with cheap
 * COUNT queries. Nothing the tool reads is requested until the admin continues.
 */
export function HeavyReadGate({ tool, children }: { tool: HeavyTool; children: React.ReactNode }) {
  const { profile } = useAuth();
  const program = useProgram();
  const teamId = profile?.teamId ?? "";
  const key = `${program}:${teamId}:${tool}`;
  const [go, setGo] = useState(() => confirmed.has(key));
  const [estimate, setEstimate] = useState<Estimate | null | undefined>(undefined);

  useEffect(() => {
    if (go || !teamId) return;
    let alive = true;
    void estimateTool(tool, program, teamId).then((e) => alive && setEstimate(e));
    return () => {
      alive = false;
    };
  }, [go, tool, program, teamId]);

  if (go || !teamId) return <>{children}</>;
  return (
    <GlassPanel className="space-y-3">
      <h2 className="text-lg font-semibold">This tool reads a lot of data</h2>
      <p className="text-sm text-[var(--muted-foreground)]">{estimate === undefined ? "Counting the documents…" : estimate ? estimate.text : UNKNOWN}</p>
      <div className="flex gap-2">
        <Button
          disabled={estimate === undefined}
          onClick={() => {
            confirmed.add(key);
            setGo(true);
          }}
        >
          Continue
        </Button>
      </div>
    </GlassPanel>
  );
}

/** For a heavy ACTION (a button, not a tab): resolves true when the admin agrees. A plain browser confirmation that states the estimate. */
export async function confirmHeavyRead(tool: HeavyTool, program: Parameters<typeof estimateTool>[1], teamId: string): Promise<boolean> {
  const estimate = await estimateTool(tool, program, teamId);
  return window.confirm(`${estimate ? estimate.text : UNKNOWN}\n\nContinue?`);
}
