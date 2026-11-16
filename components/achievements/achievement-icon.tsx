import { CalendarCheck, Flag, Flame, Layers, Medal, Sparkles, Target, Trophy, type LucideIcon } from "lucide-react";
import { SIDEBAR_ICONS, isSidebarIconKey } from "@/lib/sidebar/icons";

/** The glyphs the built-in achievements use (lib/achievements/config.ts `BUILTIN_GLYPHS`). */
const BUILTIN_ICONS: Record<string, LucideIcon> = { flag: Flag, layers: Layers, medal: Medal, target: Target, sparkles: Sparkles, flame: Flame, calendar: CalendarCheck, trophy: Trophy };

/** The one resolver of an achievement's icon: a built-in glyph, else the app's icon set (the sidebar's), else a medal. */
export function achievementIconFor(name: string): LucideIcon {
  if (Object.hasOwn(BUILTIN_ICONS, name)) return BUILTIN_ICONS[name];
  return isSidebarIconKey(name) ? SIDEBAR_ICONS[name] : Medal;
}

export function AchievementIcon({ name, className }: { name: string; className?: string }) {
  const Icon = Object.hasOwn(BUILTIN_ICONS, name) ? BUILTIN_ICONS[name] : isSidebarIconKey(name) ? SIDEBAR_ICONS[name] : Medal;
  return <Icon className={className} aria-hidden />;
}
