import { Check } from "lucide-react";
import { AchievementIcon } from "@/components/achievements/achievement-icon";
import { Progress } from "@/components/ui/progress";
import { METRICS } from "@/lib/achievements/metrics";
import type { AchievementDefinition, AchievementProgress } from "@/lib/achievements/engine";
import { cn } from "@/lib/utils";

/** "3 / 5 sessions" (a percent reads "85 / 90%"). */
export function progressText(def: AchievementDefinition, progress: AchievementProgress): string {
  const unit = METRICS[def.metric].unit;
  const join = (n: number) => (unit === "%" ? `${n}%` : `${n} ${unit}`);
  if (progress.noData) return def.metric === "average-accuracy" && (def.minSamples ?? 1) > 1 ? `Needs ${def.minSamples} sessions with an accuracy` : `No data yet · goal ${join(progress.target)}`;
  return unit === "%" ? `${progress.current}% / ${progress.target}%` : `${progress.current} / ${join(progress.target)}`;
}

/**
 * One achievement: icon, name, description, earned state and (only for the person it belongs to) a progress bar. `progress` null draws the card
 * the way other people see it: earned, no numbers.
 */
export function AchievementCard({ def, progress, earned }: { def: AchievementDefinition; progress: AchievementProgress | null; earned: boolean }) {
  const metric = METRICS[def.metric];
  return (
    <li data-testid={`achievement-${def.id}`} data-earned={earned} className={cn("glass-card flex flex-col gap-3 p-4", !earned && "border border-dashed border-[var(--glass-border)]")}>
      <div className="flex items-start gap-3">
        <span
          className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full", earned ? "text-[var(--color-primary-foreground)]" : "bg-black/5 text-[var(--muted-foreground)] dark:bg-white/10")}
          style={earned ? { background: "var(--theme-gradient)" } : undefined}
        >
          <AchievementIcon name={def.icon} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{def.name}</h3>
            {earned && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                <Check className="h-3.5 w-3.5" aria-hidden /> Earned
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">{def.description}</p>
          {def.scope === "season" && <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">This season only</p>}
        </div>
      </div>
      {progress && (
        <div className="flex flex-col gap-1.5">
          <Progress value={progress.current} max={progress.target} label={`${def.name}: ${metric.label}`} valueText={progressText(def, progress)} done={progress.earned} />
          <span className="text-xs text-[var(--muted-foreground)]" data-testid={`achievement-progress-${def.id}`}>
            {progressText(def, progress)}
          </span>
        </div>
      )}
      {!progress && <span className="sr-only">Earned.</span>}
    </li>
  );
}
