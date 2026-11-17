"use client";

import Link from "@/components/program/link";
import { usePathname } from "@/lib/program/navigation";
import { motion } from "framer-motion";
import { analyticsNav } from "@/lib/nav";
import { isUnavailableInProgram } from "@/config/programs";
import { useProgram } from "@/lib/program/context";
import { spring } from "@/lib/motion";
import { useAnalyticsHref } from "@/lib/analytics/filter-context";

export function AnalyticsTabs() {
  const pathname = usePathname();
  // Tabs carry the filters in the URL so they persist from subpage to subpage.
  const withFilters = useAnalyticsHref();
  // Only tabs for pages this program has (a program's unavailable pages are not linked from here).
  const program = useProgram();
  const tabs = analyticsNav.filter((item) => !isUnavailableInProgram(program, item.href));

  return (
    <div className="glass-pill mb-6 flex w-full flex-wrap items-center gap-1 overflow-x-auto p-1.5">
      {tabs.map((item, index) => {
        const startsGroup = !!item.group && tabs[index - 1]?.group !== item.group;
        const endsGroup = !!item.group && tabs[index + 1]?.group !== item.group;
        // A Team Profile (/analytics/teams/254) is reached from Team Averages / Rankings; keep Team Averages lit.
        const active = pathname === item.href || (item.href === "/analytics/team-averages" && pathname.startsWith("/analytics/teams/"));
        return (
          <div key={item.href} className="flex items-center gap-1" data-group={item.group}>
          {startsGroup && (
            <span className="pl-3 pr-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]" data-testid="analytics-group-label">
              {item.group}
            </span>
          )}
          <Link href={withFilters(item.href)} className="relative">
            <motion.div
              whileHover={{ scale: active ? 1 : 1.03 }}
              whileTap={{ scale: 0.97 }}
              transition={spring}
              className={`relative z-10 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors duration-200 ${
                active ? "text-[var(--color-primary-foreground)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="analytics-tab-pill"
                  transition={spring}
                  className="absolute inset-0 -z-10 rounded-full"
                  style={{
                    background: "var(--theme-gradient)",
                    boxShadow: "0 4px 18px -4px rgba(var(--glow), 0.6)",
                  }}
                />
              )}
              <span className="relative">{item.label}</span>
            </motion.div>
          </Link>
          {endsGroup && <span className="mx-1 h-5 w-px bg-[var(--glass-border)]" aria-hidden />}
          </div>
        );
      })}
    </div>
  );
}
