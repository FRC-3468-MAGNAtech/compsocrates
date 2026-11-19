"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, UserPlus } from "lucide-react";
import Link from "@/components/program/link";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FloatingPanel } from "@/components/ui/floating-panel";
import { TeamLabelView } from "@/components/team/team-label-view";
import { buildSwitcherModel, type RobotOption, type SwitcherGroup, type SwitcherModel, type SwitcherRow } from "@/components/team/team-switcher-model";
import { PROGRAMS } from "@/config/programs";
import { useAccountState, useAllProgramMemberships, type ProgramMemberships } from "@/lib/account-state";
import { useAuth } from "@/lib/auth";
import { useMembershipsEnabled, useMembershipsSettled } from "@/lib/memberships/client";
import { PROGRAM_IDS, type ProgramId } from "@/lib/memberships/model";
import { MEMBERSHIP_TEXT } from "@/lib/memberships/strings";
import { useTeamSwitch } from "@/lib/memberships/switching";
import { useAccountTeamChoice, useOurTeam } from "@/lib/our-team";
import { useProgram, useProgramConfig } from "@/lib/program/context";
import { forgetTeamLabel, listRememberedTeams, recallTeamLabel, rememberTeamLabel } from "@/lib/team-label-cache";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";

/**
 * THE team switcher: one control, in the sidebar, the mobile drawer and the top bar, for both programs. Its trigger is the ACTIVE context (the program badge, the team number in bold and
 * its name beneath, wrapping; for a team with several robot teams, the one being viewed as). Its panel lists every active membership across BOTH programs, grouped by program (choosing
 * one in the other program switches the program too, through the existing switch route), and under the ACTIVE team its robot teams to "View as" (a local choice, nothing is written to
 * the server), with a "Join another team" link. With the memberships kill switch OFF only the robot-team choice is drawn, in the same style, and only when there are two or more.
 * Never two dropdowns. The panel is anchored under the trigger at the trigger's width (a bottom sheet on a phone) and scrolls inside the room on screen.
 * Labels come only from `lib/team-label.ts` (never an id); this component reads nothing new on a page load: the other program's memberships are read once, when the panel is first opened.
 */
export function TeamSwitcher({ className, compact = false }: { className?: string; compact?: boolean }) {
  const settled = useMembershipsSettled();
  const enabled = useMembershipsEnabled();
  if (!settled) return null;
  return enabled ? <SwitcherWithMemberships className={className} compact={compact} /> : <SwitcherRobotsOnly className={className} compact={compact} />;
}

const badgeOf = (program: ProgramId): string => PROGRAMS[program].brand.label;
const IDLE_ALL = Object.fromEntries(PROGRAM_IDS.map((p) => [p, { status: "idle", memberships: [] }])) as unknown as Record<ProgramId, ProgramMemberships>;

function useRobotChoice() {
  const { multiTeam } = useProgramConfig();
  const choice = useAccountTeamChoice();
  return { teams: multiTeam ? choice.teams : [], selectedId: choice.selectedId, select: choice.select };
}

/** Memberships switch OFF: the robot-team choice only, and only with two or more. No memberships read, nothing else. */
function SwitcherRobotsOnly({ className, compact }: { className?: string; compact: boolean }) {
  const program = useProgram();
  const { user, profile } = useAuth();
  const ours = useOurTeam();
  const robots = useRobotChoice();
  const uid = user?.uid ?? null;
  const activeTeamId = profile?.teamId?.trim() ? profile.teamId : null;
  const model = useMemo(
    () =>
      buildSwitcherModel({
        membershipsOn: false,
        program,
        activeTeamId,
        current: null,
        others: IDLE_ALL,
        ours,
        robots,
        badgeOf,
        recall: (p, teamId, kind) => recallTeamLabel(uid, p, teamId, kind),
        remembered: () => [],
      }),
    [program, activeTeamId, ours, robots, uid]
  );
  useRememberLabels(uid, program, activeTeamId, ours, model);
  return <TeamSwitcherView model={model} className={className} compact={compact} error={null} onOpen={() => {}} onPickTeam={() => {}} onPickRobot={robots.select} onClearError={() => {}} />;
}

/** Memberships switch ON. */
function SwitcherWithMemberships({ className, compact }: { className?: string; compact: boolean }) {
  const program = useProgram();
  const { user } = useAuth();
  const state = useAccountState();
  const ours = useOurTeam();
  const robots = useRobotChoice();
  const { switchTo, error, clearError } = useTeamSwitch();
  const [opened, setOpened] = useState(false);
  const all = useAllProgramMemberships(opened);
  const uid = user?.uid ?? null;
  const current = state.status === "loading" ? null : state.memberships;
  const model = useMemo(
    () =>
      buildSwitcherModel({
        membershipsOn: true,
        program,
        activeTeamId: state.activeTeamId,
        current,
        others: all,
        ours,
        robots,
        badgeOf,
        recall: (p, teamId, kind) => recallTeamLabel(uid, p, teamId, kind),
        remembered: (p) => listRememberedTeams(uid, p),
      }),
    [program, state.activeTeamId, current, all, ours, robots, uid]
  );
  useRememberLabels(uid, program, state.activeTeamId, ours, model);
  // The other program's list was read: forget remembered teams it no longer holds (left, or removed).
  useEffect(() => {
    if (!uid) return;
    for (const g of model.groups) {
      if (g.isCurrent || g.status !== "ready") continue;
      const listed = new Set(g.rows.map((r) => r.teamId));
      for (const old of listRememberedTeams(uid, g.program)) if (!listed.has(old.teamId)) forgetTeamLabel(uid, g.program, old.teamId);
    }
  }, [model.groups, uid]);
  if (state.status === "loading") return null;
  return (
    <TeamSwitcherView
      model={model}
      className={className}
      compact={compact}
      error={error}
      onOpen={() => setOpened(true)}
      onPickTeam={(row) => {
        clearError();
        void switchTo(row.teamId, row.program);
      }}
      onPickRobot={robots.select}
      onClearError={clearError}
    />
  );
}

/** Remember what was learned from live data, so the next page load paints it at once. Only READY labels (a real number or name) are ever stored. */
function useRememberLabels(uid: string | null, program: ProgramId, activeTeamId: string | null, ours: ReturnType<typeof useOurTeam>, model: SwitcherModel) {
  useEffect(() => {
    if (!uid || !activeTeamId || !ours.loaded) return;
    if (ours.number !== null || ours.name) rememberTeamLabel(uid, program, activeTeamId, "context", { number: ours.number !== null ? String(ours.number) : null, name: ours.name });
  }, [uid, program, activeTeamId, ours.loaded, ours.number, ours.name]);
  useEffect(() => {
    if (!uid) return;
    for (const g of model.groups) {
      if (g.status !== "ready") continue;
      for (const r of g.rows) if (r.label.state === "ready") rememberTeamLabel(uid, r.program, r.teamId, "team", { number: r.label.number, name: r.label.name });
    }
  }, [uid, model.groups]);
}

export type TeamSwitcherViewProps = {
  model: SwitcherModel;
  className?: string;
  compact?: boolean;
  /** The last switch failure, in words (shown in the panel while it is open, under the trigger otherwise). */
  error: string | null;
  onOpen: () => void;
  onPickTeam: (row: SwitcherRow) => void;
  onPickRobot: (id: string) => void;
  onClearError: () => void;
};

/** The drawn switcher (props only, so tests render every state). */
export function TeamSwitcherView({ model, className, compact = false, error, onOpen, onPickTeam, onPickRobot, onClearError }: TeamSwitcherViewProps) {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState<number | undefined>(undefined);
  const phone = useMediaQuery("(max-width: 639px)");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // A floating panel closes on an outside press and on Escape (a dialog does both itself).
  useEffect(() => {
    if (!open || phone) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, phone]);

  if (!model.worthShowing) return null;

  const toggle = () => {
    onClearError();
    if (!open) {
      onOpen();
      // Anchored at the trigger's own width (the sidebar), and no narrower than a readable list in the compact top bar.
      const w = triggerRef.current?.offsetWidth ?? 256;
      setWidth(compact ? Math.min(Math.max(w, 288), (typeof window === "undefined" ? 360 : window.innerWidth) - 16) : w);
    }
    setOpen(!open);
  };
  const body = (
    <TeamSwitcherPanelBody
      model={model}
      error={error}
      onPickTeam={(row) => {
        if (row.active) setOpen(false);
        else onPickTeam(row);
      }}
      onPickRobot={(id) => {
        onPickRobot(id);
        setOpen(false);
      }}
      onJoin={() => setOpen(false)}
    />
  );

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)} data-testid="membership-team-switcher">
      <button
        ref={triggerRef}
        type="button"
        aria-label={MEMBERSHIP_TEXT.switcher.label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
        data-testid="team-switcher"
        className={cn("glass-pill flex min-h-11 w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left", compact && "max-w-[11rem]")}
      >
        <span className="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" data-testid="team-switcher-badge">
          {model.trigger.badge}
        </span>
        <TeamLabelView label={model.trigger.label} className="flex-1 py-0.5" nameLines={2} />
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition-transform", open && "rotate-180")} />
      </button>
      {error && !open && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
      {phone ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-sm:p-4" aria-describedby={undefined}>
            <DialogTitle className="mb-2 text-base">{MEMBERSHIP_TEXT.switcher.panelTitle}</DialogTitle>
            {body}
          </DialogContent>
        </Dialog>
      ) : (
        <FloatingPanel anchorRef={triggerRef} panelRef={panelRef} open={open} style={{ width }} className="rounded-2xl p-1 shadow-2xl" data-testid="team-switcher-panel">
          {body}
        </FloatingPanel>
      )}
    </div>
  );
}

/** What is inside the panel (a floating panel or a bottom sheet): the groups of teams, the robot teams under the active one, the Join link, an inline notice. */
export function TeamSwitcherPanelBody({
  model,
  error,
  onPickTeam,
  onPickRobot,
  onJoin,
}: {
  model: SwitcherModel;
  error: string | null;
  onPickTeam: (row: SwitcherRow) => void;
  onPickRobot: (id: string) => void;
  onJoin: () => void;
}) {
  const withTeams = model.groups.length > 0;
  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid="team-switcher-body">
      {error && (
        <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300" data-testid="team-switcher-error">
          {error}
        </p>
      )}
      {withTeams ? (
        model.groups.map((group) => <GroupSection key={group.program} group={group} robots={model.robots} onPickTeam={onPickTeam} onPickRobot={onPickRobot} />)
      ) : (
        <RobotList robots={model.robots} onPickRobot={onPickRobot} bare />
      )}
      {withTeams && (
        <Link href="/apply-to-team" onClick={onJoin} className="mt-1 flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm text-[var(--muted-foreground)] transition-colors hover:bg-white/8 hover:text-[var(--foreground)]" data-testid="team-switcher-join">
          <UserPlus className="h-4 w-4 shrink-0" /> {MEMBERSHIP_TEXT.switcher.joinAnother}
        </Link>
      )}
    </div>
  );
}

function GroupSection({ group, robots, onPickTeam, onPickRobot }: { group: SwitcherGroup; robots: RobotOption[]; onPickTeam: (row: SwitcherRow) => void; onPickRobot: (id: string) => void }) {
  return (
    <div role="group" aria-label={group.badge} className="flex flex-col gap-0.5" data-testid={`team-switcher-group-${group.program}`}>
      <div className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{group.badge}</div>
      {group.rows.map((row) => (
        <div key={row.key} className="flex flex-col">
          <button
            type="button"
            onClick={() => onPickTeam(row)}
            aria-current={row.active ? "true" : undefined}
            className={cn("flex min-h-11 w-full min-w-0 items-start gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/8", row.active && "bg-white/8")}
            data-testid={`team-switcher-row-${row.key}`}
          >
            <TeamLabelView label={row.label} className="flex-1" nameLines={3} />
            {row.active && <Check className="mt-0.5 h-4 w-4 shrink-0" aria-label="Active" />}
          </button>
          {row.active && robots.length >= 2 && <RobotList robots={robots} onPickRobot={onPickRobot} />}
        </div>
      ))}
      {group.rows.length === 0 && (
        <p className="px-3 py-2 text-xs text-[var(--muted-foreground)]">{group.status === "ready" ? MEMBERSHIP_TEXT.switcher.otherEmpty : MEMBERSHIP_TEXT.switcher.otherLoading}</p>
      )}
      {group.rows.length > 0 && group.status === "loading" && <p className="px-3 py-1 text-xs text-[var(--muted-foreground)]">{MEMBERSHIP_TEXT.switcher.otherLoading}</p>}
    </div>
  );
}

function RobotList({ robots, onPickRobot, bare = false }: { robots: RobotOption[]; onPickRobot: (id: string) => void; bare?: boolean }) {
  if (robots.length === 0) return null;
  return (
    <div role="group" aria-label={MEMBERSHIP_TEXT.switcher.viewAs} className={cn("flex flex-col gap-0.5", !bare && "ml-3 border-l border-[var(--glass-border)] pl-2")} data-testid="team-switcher-robots">
      <div className="px-3 pt-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{MEMBERSHIP_TEXT.switcher.viewAs}</div>
      {robots.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onPickRobot(r.id)}
          aria-current={r.selected ? "true" : undefined}
          className={cn("flex min-h-11 w-full min-w-0 items-start gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/8", r.selected && "bg-white/8")}
          data-testid={`team-switcher-robot-${r.id}`}
        >
          <TeamLabelView label={{ state: "ready", number: String(r.number), name: r.name, text: `Team ${r.number}` }} className="flex-1" nameLines={3} />
          {r.selected && <Check className="mt-0.5 h-4 w-4 shrink-0" aria-label="Selected" />}
        </button>
      ))}
    </div>
  );
}
