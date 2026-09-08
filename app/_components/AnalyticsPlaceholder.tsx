import { LucideIcon } from "lucide-react";
import PageShell from "./PageShell";
import GlassCard from "./GlassCard";
import StatTile from "./StatTile";
import PlaceholderTable from "./PlaceholderTable";

type Stat = { label: string; value: string; hint?: string; icon?: LucideIcon; accent?: "volt" | "plasma" | "current" | "signal" | "amber" };

type AnalyticsPlaceholderProps = {
  title: string;
  description: string;
  stats?: Stat[];
  columns: string[];
  chartLabel?: string;
  accent?: "volt" | "plasma" | "current" | "signal" | "amber";
};

export default function AnalyticsPlaceholder({
  title,
  description,
  stats = [],
  columns,
  chartLabel = "Trend Visualization",
  accent = "current",
}: AnalyticsPlaceholderProps) {
  return (
    <PageShell title={title} eyebrow="Analytics" description={description}>
      <div className="space-y-6">
        {stats.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-3">
            {stats.map((s) => (
              <StatTile key={s.label} {...s} accent={s.accent ?? accent} />
            ))}
          </div>
        )}
        <GlassCard accent={accent} className="flex h-52 items-center justify-center">
          <span className="text-sm font-medium text-[var(--cs-text-faint)]">{chartLabel} — chart placeholder</span>
        </GlassCard>
        <PlaceholderTable columns={columns} />
      </div>
    </PageShell>
  );
}
