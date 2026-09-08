import Link from "next/link";
import {
  Swords,
  ClipboardList,
  Wrench,
  BookOpenCheck,
  ListChecks,
  BarChart3,
  ListOrdered,
  Trophy,
  ShieldCheck,
  Radar,
  UserCog,
  ArrowUpRight,
} from "lucide-react";
import PageShell from "../_components/PageShell";
import GlassCard from "../_components/GlassCard";

const rawData = [
  { label: "Match", href: "/analytics/match", icon: Swords },
  { label: "Lead", href: "/analytics/lead", icon: ClipboardList },
  { label: "Pit", href: "/analytics/pit", icon: Wrench },
  { label: "Team Strategy", href: "/analytics/team-strategy", icon: Wrench },
  { label: "Match Strategy", href: "/analytics/match-strategy", icon: Swords },
  { label: "Drive Reflection", href: "/analytics/drive-reflection", icon: BookOpenCheck },
  { label: "Helper Reports", href: "/analytics/helper-reports", icon: ListChecks },
];

const organizedData = [
  { label: "Team Averages", href: "/analytics/team-averages", icon: BarChart3 },
  { label: "Match Breakdown", href: "/analytics/match-breakdown", icon: ListOrdered },
  { label: "Rankings", href: "/analytics/rankings", icon: Trophy },
  { label: "Team Breakdown", href: "/analytics/team-breakdown", icon: BarChart3 },
  { label: "Performance Reliability", href: "/analytics/performance-reliability", icon: ShieldCheck },
  { label: "Robot Radar", href: "/analytics/robot-radar", icon: Radar },
  { label: "Pick List", href: "/analytics/pick-list", icon: ListChecks },
  { label: "Scout Status", href: "/analytics/scout-status", icon: UserCog },
];

function AnalyticsGroup({
  title,
  items,
  accent,
}: {
  title: string;
  items: typeof rawData;
  accent: "current" | "signal";
}) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--cs-text-dim)]">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <Link key={item.href} href={item.href}>
            <GlassCard accent={accent} className="flex items-center justify-between">
              <span className="flex items-center gap-3 text-sm font-semibold text-[var(--cs-text)]">
                <item.icon size={16} className={accent === "current" ? "text-[var(--cs-current)]" : "text-[var(--cs-signal)]"} />
                {item.label}
              </span>
              <ArrowUpRight size={15} className="text-[var(--cs-text-faint)]" />
            </GlassCard>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function AnalyticsIndexPage() {
  return (
    <PageShell
      title="Analytics"
      eyebrow="Analytics"
      description="Explore raw scouting submissions or the organized, computed views built from them."
    >
      <div className="space-y-10">
        <AnalyticsGroup title="Raw Data" items={rawData} accent="current" />
        <AnalyticsGroup title="Organized Data" items={organizedData} accent="signal" />
      </div>
    </PageShell>
  );
}
