"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "@/components/program/link";
import { usePathname, useRouter } from "@/lib/program/navigation";import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronsLeft, ChevronsRight, LogOut, Trophy } from "lucide-react";
import { useAccessUser, usePageAccess } from "@/lib/page-access/store";
import { pageLabel } from "@/lib/sidebar/layout";
import { resolveSidebar, type ResolvedSidebar, type SidebarNode } from "@/lib/sidebar/resolve";
import { useSidebarConfig } from "@/lib/sidebar/store";
import { cn } from "@/lib/utils";
import { spring } from "@/lib/motion";
import { ColorModeToggle } from "@/components/theme/color-mode-toggle";
import { ConnectionChip } from "@/components/layout/connection-chip";
import { useOurTeam } from "@/lib/our-team";
import { teamLabel } from "@/lib/team-number";
import { usePermissions } from "@/lib/permissions";
import { usePendingApplicationCount } from "@/lib/applications-client";
import { GlassLayerButton } from "@/components/theme/glass-layer-slider";
import type { ConnectionNotice } from "@/lib/connection-notice";
import { Avatar } from "@/components/ui/avatar";
import { useAuth } from "@/lib/auth";
import { getRole } from "@/lib/roles";
import { useChangelogUnread } from "@/lib/changelog/store";
import { BRAND, storageKey } from "@/config/brand";
import { useProgram, useProgramConfig } from "@/lib/program/context";
import { ProgramSwitcher } from "@/components/program/program-switcher";
import { TeamSwitcher } from "@/components/program/team-switcher";

function NavLink({
  item,
  child = false,
  collapsed,
  onNavigate,
  scope,
  unread = false,
  count = 0,
}: {
  item: SidebarNode;
  /** Inside a group: indented. */
  child?: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
  scope: string;
  /** P14: show the "something new" dot (Changelog). Hidden while you're on the page itself. */
  unread?: boolean;
  /** P20: a count badge (the platform owner's pending applications on Admin Panel). */
  count?: number;
}) {
  const active = item.active;
  const Icon = item.icon;
  const href = item.href ?? "/";

  return (
    <Link href={href} onClick={onNavigate} className={cn("relative block", child && !collapsed && "ml-5")}>
      <motion.div
        whileHover={{ x: collapsed ? 0 : 3 }}
        transition={spring}
        className={cn(
          "relative flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm font-medium transition-colors duration-200 pointer-coarse:min-h-11",
          active
            ? "text-[var(--color-primary-foreground)]"
            : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-white/6"
        )}
      >
        {active && (
          <motion.div
            layoutId={`sidebar-active-pill-${scope}`}
            transition={spring}
            className="absolute inset-0 -z-10 rounded-2xl"
            style={{
              background: "var(--theme-gradient)",
              boxShadow: "0 8px 24px -6px rgba(var(--glow), 0.55)",
            }}
          />
        )}
        <span className="relative shrink-0">
          <Icon className="h-[18px] w-[18px]" />
          {unread && !active && collapsed && <UnreadDot className="absolute -right-1 -top-1" />}
          {count > 0 && collapsed && <CountBadge count={count} className="absolute -right-2 -top-2" />}
        </span>
        {!collapsed && <span className="truncate">{item.label}</span>}
        {unread && !active && !collapsed && <UnreadDot className="ml-auto" />}
        {count > 0 && !collapsed && <CountBadge count={count} className="ml-auto" />}
      </motion.div>
    </Link>
  );
}

/** Which groups are open, remembered per device and program (a browser preference, never stored on the team). */
function useOpenGroups(program: string, activeGroupId: string | null) {
  const key = storageKey(`sidebar-open.${program}`);
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try {
      const raw = typeof window === "undefined" ? null : window.localStorage.getItem(key);
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? (parsed as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });
  // Walking into a group's page opens it (adjusted during render, so there is no flash of a closed group).
  const [seenActive, setSeenActive] = useState(activeGroupId);
  if (seenActive !== activeGroupId) {
    setSeenActive(activeGroupId);
    if (activeGroupId && !open[activeGroupId]) setOpen({ ...open, [activeGroupId]: true });
  }
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(open));
    } catch {
      // storage blocked: the open state just is not remembered
    }
  }, [key, open]);
  // The group holding the current page is open even before anything is stored.
  const isOpen = (id: string) => open[id] ?? id === activeGroupId;
  const toggle = (id: string) => setOpen({ ...open, [id]: !isOpen(id) });
  return { isOpen, toggle };
}

/** A parent button: expands and collapses its children (indented). Highlighted while the current page is inside it. */
function GroupNav({
  node,
  open,
  onToggle,
  collapsed,
  onNavigate,
  scope,
  unreadId,
  countFor,
}: {
  node: SidebarNode;
  open: boolean;
  onToggle: () => void;
  collapsed: boolean;
  onNavigate?: () => void;
  scope: string;
  unreadId: string | null;
  countFor: (id: string) => number;
}) {
  const Icon = node.icon;
  const panelId = `sidebar-group-${scope}-${node.id}`;
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={collapsed ? node.label : undefined}
        title={collapsed ? node.label : undefined}
        onClick={onToggle}
        data-testid={`sidebar-group-${node.id}`}
        className={cn(
          "flex w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left text-sm font-medium transition-colors duration-200 pointer-coarse:min-h-11",
          node.active ? "bg-white/8 text-[var(--foreground)]" : "text-[var(--muted-foreground)] hover:bg-white/6 hover:text-[var(--foreground)]"
        )}
      >
        <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
        {!collapsed && <span className="truncate">{node.label}</span>}
        {!collapsed && <ChevronDown aria-hidden className={cn("ml-auto h-4 w-4 shrink-0 transition-transform duration-200", open && "rotate-180")} />}
      </button>
      {open && (
        <div id={panelId} className="mt-1 flex flex-col gap-1">
          {node.children?.map((child) => (
            <NavLink key={child.id} item={child} child collapsed={collapsed} onNavigate={onNavigate} scope={scope} unread={child.id === unreadId} count={countFor(child.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** P20: "N waiting". Always the accent fill with its guarded on-accent text, so it stays legible in every theme. */
function CountBadge({ count, className }: { count: number; className?: string }) {
  return (
    <span className={cn("flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] px-1.5 text-[10px] font-semibold tabular-nums text-[var(--color-primary-foreground)]", className)} data-testid="admin-count">
      {count > 99 ? "99+" : count}
      <span className="sr-only"> applications waiting</span>
    </span>
  );
}

function UnreadDot({ className }: { className?: string }) {
  return (
    <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--color-accent)] shadow-[0_0_10px_2px_rgba(var(--glow),0.7)]", className)}>
      <span className="sr-only">New updates</span>
    </span>
  );
}

export function Sidebar({ mobileOpen, onClose, connection = null }: { mobileOpen?: boolean; onClose?: () => void; connection?: ConnectionNotice | null }) {
  const [collapsed, setCollapsed] = useState(false);
  const { profile, logout } = useAuth();
  const router = useRouter();
  const name = profile?.name ?? "";
  const isAdmin = profile?.isAdmin ?? false;
  // The one resolver: the code's pages, arranged by the team's config, then hidden by the same access checks as the route guard (P26) and the admin-only Admin Panel.
  // The layout is the cached or default one until the live config arrives, so nothing flashes.
  const pageAccess = usePageAccess();
  const accessUser = useAccessUser();
  const canOpen = accessUser ? pageAccess.can : null;
  const { config } = useSidebarConfig();
  const program = useProgram();
  const pathname = usePathname();
  const resolved = useMemo(
    () => resolveSidebar({ program, isAdmin, can: canOpen, config, labelOf: pageLabel, pathname }),
    [program, isAdmin, canOpen, config, pathname]
  );
  // The changelog is read from the default program's collection, so a program without it connected asks for nothing (no team = no subscription).
  const { features } = useProgramConfig().connection;
  const changelogUnread = useChangelogUnread(features.changelog ? (profile?.teamId ?? null) : null, profile?.lastSeenChangelogAt);

  const handleLogout = () => {
    void logout();
    onClose?.();
    router.push("/");
  };

  return (
    <>
      {/* The outer aside only positions and sizes; the glass panel (which must clip its scrolling content) is an inner
          box, and the collapse arrow is a sibling of it. That's what lets the arrow straddle the edge: with it inside the
          overflow-hidden glass panel it was cut in half (P18). */}
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 84 : 272 }}
        transition={spring}
        className="sticky top-4 z-[var(--z-sidebar)] hidden h-[calc(100dvh-2rem)] shrink-0 lg:block"
      >
        <div className="glass-panel flex h-full flex-col gap-4 overflow-hidden p-4">
          <SidebarInner
            collapsed={collapsed}
            name={name}
            primaryRole={profile?.primaryRole}
            resolved={resolved}
            changelogUnread={changelogUnread}
            connection={connection}
            onLogout={handleLogout}
            scope="desktop"
          />
        </div>
        <button
          onClick={() => setCollapsed((c) => !c)}
          data-testid="sidebar-collapse"
          className="glass-pill touch-compact absolute -right-3.5 top-8 z-10 flex h-7 w-7 items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronsRight className="h-3.5 w-3.5" /> : <ChevronsLeft className="h-3.5 w-3.5" />}
        </button>
      </motion.aside>

      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-[var(--z-sheet)] lg:hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={spring}
              className="absolute inset-0 bg-black/50 scrim-blur"
              onClick={onClose}
            />
            <motion.aside
              initial={{ x: -300, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -300, opacity: 0 }}
              transition={spring}
              className="glass-panel absolute left-3 top-3 bottom-3 flex w-[272px] flex-col gap-4 overflow-y-auto p-4"
            >
              <SidebarInner
                collapsed={false}
                name={name}
                primaryRole={profile?.primaryRole}
                resolved={resolved}
          changelogUnread={changelogUnread}
          connection={connection}
                onLogout={handleLogout}
                onNavigate={onClose}
                scope="mobile"
              />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

function SidebarInner({
  collapsed,
  name,
  primaryRole,
  resolved,
  changelogUnread,
  connection,
  onLogout,
  onNavigate,
  scope,
}: {
  collapsed: boolean;
  name: string;
  primaryRole?: string;
  resolved: ResolvedSidebar;
  changelogUnread: boolean;
  connection: ConnectionNotice | null;
  onLogout: () => void;
  onNavigate?: () => void;
  scope: string;
}) {
  const role = primaryRole ? getRole(primaryRole) : null;
  const { profile: me } = useAuth();
  const { number: ourNumber, name: ourName } = useOurTeam();
  // P20: the platform owner sees how many team applications are waiting, on the Admin Panel item.
  const { isPlatformOwner } = usePermissions();
  const { features: programFeatures } = useProgramConfig().connection;
  const pendingApplications = usePendingApplicationCount(isPlatformOwner && programFeatures.applications);
  const program = useProgram();
  const activeGroupId = [...resolved.main, ...resolved.footer].find((n) => n.kind === "group" && n.active)?.id ?? null;
  const { isOpen, toggle } = useOpenGroups(program, activeGroupId);
  const renderNode = (node: SidebarNode) =>
    node.kind === "group" ? (
      <GroupNav
        key={node.id}
        node={node}
        open={isOpen(node.id)}
        onToggle={() => toggle(node.id)}
        collapsed={collapsed}
        onNavigate={onNavigate}
        scope={scope}
        unreadId={changelogUnread ? "changelog" : null}
        countFor={(id) => (id === "admin-panel" ? pendingApplications : 0)}
      />
    ) : (
      <NavLink key={node.id} item={node} collapsed={collapsed} onNavigate={onNavigate} scope={scope} unread={node.id === "changelog" && changelogUnread} count={node.id === "admin-panel" ? pendingApplications : 0} />
    );
  return (
    <>
      {/* The team line is data-driven: our team's number and name under the wordmark (lib/our-team.ts; a multi-team switcher would go here). */}
      <div className="flex flex-col gap-2">
        <Link href="/dashboard" className="flex items-center gap-2.5 px-1.5 py-1">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            style={{ background: "var(--theme-gradient)" }}
          >
            <Trophy className="h-[18px] w-[18px] text-[var(--color-primary-foreground)]" />
          </span>
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{BRAND.name}</div>
              {ourNumber !== null && (
                <div className="truncate text-[11px] text-[var(--muted-foreground)]" data-testid="our-team-line">
                  {teamLabel(ourNumber, ourName)}
                </div>
              )}
            </div>
          )}
        </Link>
      </div>

      {!collapsed && <ProgramSwitcher className="mb-1" />}
      {!collapsed && <TeamSwitcher className="mb-1" />}
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto py-1">
        {resolved.main.map(renderNode)}
        {resolved.footer.length > 0 && <div className="my-2 h-px bg-[var(--glass-border)]" />}
        {resolved.footer.map(renderNode)}
      </nav>

      <div className="flex flex-col gap-3 border-t border-[var(--glass-border)] pt-3">
        {/* P18: the internet status has its own always-visible spot (solid backing, no layout shift), and the theme picker
            is gone from here: the sun/moon is only the light/dark mode, the droplet is the glass slider. */}
        <div className={cn("flex", collapsed ? "justify-center" : "")}>
          <ConnectionChip connection={connection} collapsed={collapsed} />
        </div>
        <div className={cn("flex items-center gap-2", collapsed ? "flex-col" : "justify-center")}>
          <ColorModeToggle compact />
          <GlassLayerButton compact />
        </div>
        <div className="flex items-center gap-2.5 px-1">
          {/* P25: the name and picture open your profile. */}
          <Link href="/profile" onClick={onNavigate} aria-label="Your profile" className={cn("flex min-w-0 items-center gap-2.5", !collapsed && "flex-1")}>
            <Avatar name={name} size="sm" avatar={me?.avatar} />
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{name}</div>
                {role && <div className={cn("mt-0.5 inline-block truncate rounded-full px-2 py-0.5 text-[10px] font-medium", role.className)}>{role.label}</div>}
              </div>
            )}
          </Link>
          <button
            onClick={onLogout}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--muted-foreground)] transition-colors hover:bg-white/8 hover:text-[var(--foreground)]"
            aria-label="Log out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </>
  );
}
