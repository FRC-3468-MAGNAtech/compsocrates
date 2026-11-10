import { GlassPanel } from "@/components/ui/glass-panel";
import { cn } from "@/lib/utils";

const linkClass = "underline underline-offset-4 hover:text-[var(--foreground)]";

/** The data-source credit CS shows on event pages (CS components/DataSourceCredits.tsx): FIRST asks API users to link back to the API page. */
export function DataSourceCredits({ className }: { className?: string }) {
  return (
    <GlassPanel className={cn("flex flex-col gap-1 p-4", className)}>
      <h2 className="text-sm font-semibold">Data Sources</h2>
      <p className="text-xs text-[var(--muted-foreground)]">
        Event and match data may include information from{" "}
        <a href="https://www.thebluealliance.com/" target="_blank" rel="noreferrer" className={linkClass}>
          The Blue Alliance
        </a>{" "}
        and the official{" "}
        <a href="https://frc-events.firstinspires.org/services/API" target="_blank" rel="noreferrer" className={linkClass}>
          FIRST API
        </a>
        .
      </p>
      <p className="text-xs text-[var(--muted-foreground)]">
        FIRST asks developers using API data to link back to the API page above in accordance with their Terms of Use. FIRST API data may not be used for commercial purposes.
      </p>
    </GlassPanel>
  );
}
