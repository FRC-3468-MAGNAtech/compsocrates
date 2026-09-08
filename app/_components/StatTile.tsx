import { LucideIcon } from "lucide-react";
import GlassCard from "./GlassCard";

type StatTileProps = {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  accent?: "volt" | "plasma" | "current" | "signal" | "amber";
};

const colorMap: Record<string, string> = {
  volt: "text-[var(--cs-volt)]",
  plasma: "text-[var(--cs-plasma)]",
  current: "text-[var(--cs-current)]",
  signal: "text-[var(--cs-signal)]",
  amber: "text-[var(--cs-amber)]",
};

export default function StatTile({ label, value, hint, icon: Icon, accent = "current" }: StatTileProps) {
  return (
    <GlassCard accent={accent} className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-[var(--cs-text-dim)]">{label}</span>
        {Icon && <Icon size={16} className={colorMap[accent]} />}
      </div>
      <span className="text-2xl font-bold text-[var(--cs-text)]">{value}</span>
      {hint && <span className="text-xs text-[var(--cs-text-faint)]">{hint}</span>}
    </GlassCard>
  );
}
