"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronDown, Zap } from "lucide-react";
import { navGroups } from "./navConfig";

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export default function Sidebar() {
  const pathname = usePathname();
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const toggle = (label: string) =>
    setCollapsedGroups((prev) => ({ ...prev, [label]: !prev[label] }));

  return (
    <aside className="hidden w-72 flex-shrink-0 flex-col border-r border-[var(--cs-border)] bg-black/30 backdrop-blur-xl lg:flex">
      <div className="flex items-center gap-2 px-6 py-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[var(--cs-volt)]/15 text-[var(--cs-volt)]">
          <Zap size={18} strokeWidth={2.5} />
        </div>
        <div>
          <p className="text-sm font-bold leading-tight tracking-tight">CompSocrates</p>
          <p className="text-[11px] leading-tight text-[var(--cs-text-faint)]">FRC Scouting Suite</p>
        </div>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-4 pb-8">
        {navGroups.map((group) => (
          <div key={group.label}>
            <div className="mb-2 flex items-center gap-2 px-2">
              <group.icon size={13} className="text-[var(--cs-current)]" />
              <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--cs-text-faint)]">
                {group.label}
              </span>
            </div>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors ${
                        active
                          ? "bg-[var(--cs-volt)]/12 text-[var(--cs-volt)] font-semibold"
                          : "text-[var(--cs-text-dim)] hover:bg-white/5 hover:text-[var(--cs-text)]"
                      }`}
                    >
                      <item.icon size={15} />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>

            {group.children?.map((sub) => {
              const collapsed = collapsedGroups[sub.label];
              return (
                <div key={sub.label} className="mt-2 ml-2 border-l border-[var(--cs-border)] pl-3">
                  <button
                    onClick={() => toggle(sub.label)}
                    className="mb-1 flex w-full items-center justify-between px-2 py-1 text-left"
                  >
                    <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--cs-text-faint)]">
                      <sub.icon size={12} />
                      {sub.label}
                    </span>
                    <ChevronDown
                      size={13}
                      className={`text-[var(--cs-text-faint)] transition-transform ${collapsed ? "-rotate-90" : ""}`}
                    />
                  </button>
                  {!collapsed && (
                    <ul className="space-y-0.5">
                      {sub.items.map((item) => {
                        const active = isActive(pathname, item.href);
                        return (
                          <li key={item.href}>
                            <Link
                              href={item.href}
                              className={`flex items-center gap-2.5 rounded-xl px-3 py-1.5 text-[13px] transition-colors ${
                                active
                                  ? "bg-[var(--cs-current)]/12 text-[var(--cs-current)] font-semibold"
                                  : "text-[var(--cs-text-dim)] hover:bg-white/5 hover:text-[var(--cs-text)]"
                              }`}
                            >
                              <item.icon size={13} />
                              {item.label}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
