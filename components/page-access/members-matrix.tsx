"use client";

import { memo, useCallback, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Ban, Check, ChevronDown, ChevronRight, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HEAD, PINNED } from "@/components/page-access/role-matrix";
import { rolesOf, type AccessUser, type MemberPageState, type PageAccessConfig } from "@/lib/page-access/access";
import { cellAction, cellLabel, cellState, type CellKind, type CellState } from "@/lib/page-access/matrix";
import { filterGroups, type AccessPageGroup, type AccessPageRow } from "@/lib/page-access/page-list";
import { ROLES, getRole, type RoleId } from "@/lib/roles";
import type { TeamMember } from "@/lib/team-members";
import { cn } from "@/lib/utils";

// Session 6: the All Members matrix. Rows are the team's ACTIVE members (the roster read, so a person who left is never listed), columns the pages in sidebar
// group order. Every cell comes from `cellState` (which asks `explainAccess`): solid check = granted to this member, grey check = through a role (or open to
// everyone), locked check = always available, red = blocked for this member (a per-member deny already exists), empty = no access. A click on an empty or solid
// cell toggles the member's own grant and saves at once (the same as the member view); a grey cell explains where the access comes from.

const asAccessUser = (m: TeamMember): AccessUser => ({ uid: m.uid, isAdmin: m.isAdmin, isOwner: m.isOwner, primaryRole: m.primaryRole, secondaryRoles: m.secondaryRoles });

/** Rows shown before "Show more": plain row windowing for very large teams. */
const ROW_WINDOW = 120;

type Col = { row: AccessPageRow; groupId: string };
type Slot = { kind: "col"; col: Col } | { kind: "collapsed"; groupId: string };
type Note = { key: string; text: string; roleLink?: RoleId; unblock?: { uid: string; pageId: string } };

const KIND_STYLE: Record<CellKind, string> = {
  granted: "text-[var(--color-primary-foreground)] [background:var(--theme-gradient)] border-transparent",
  role: "border-[var(--glass-border)] bg-white/10 text-[var(--muted-foreground)]",
  open: "border-[var(--glass-border)] bg-white/10 text-[var(--muted-foreground)]",
  always: "border-[var(--glass-border)] bg-white/10 text-[var(--muted-foreground)]",
  blocked: "border-red-400/40 bg-red-500/15 text-red-300",
  none: "border-[var(--glass-border)] bg-transparent",
};

function CellIcon({ kind }: { kind: CellKind }) {
  if (kind === "granted" || kind === "role" || kind === "open") return <Check className="h-4 w-4" strokeWidth={3} aria-hidden />;
  if (kind === "always") return <Lock className="h-3.5 w-3.5" aria-hidden />;
  if (kind === "blocked") return <Ban className="h-4 w-4" aria-hidden />;
  return null;
}

/** The legend above the table: the same pictures the cells use. */
function Legend() {
  const item = (kind: CellKind, text: string) => (
    <li className="flex items-center gap-2">
      <span className={cn("flex h-6 w-6 items-center justify-center rounded-lg border", KIND_STYLE[kind])} aria-hidden>
        <CellIcon kind={kind} />
      </span>
      {text}
    </li>
  );
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--muted-foreground)]" aria-label="Legend" data-testid="matrix-legend">
      {item("granted", "Granted to this member")}
      {item("role", "Through their role, or open to everyone (change it in Roles)")}
      {item("always", "Always available, locked")}
      {item("blocked", "Blocked for this member")}
      {item("none", "No access")}
    </ul>
  );
}

type RowProps = {
  member: TeamMember;
  r: number;
  cols: Slot[];
  states: CellState[];
  /** The column that holds the tab stop in this row, or -1. */
  activeC: number;
};

/** One member's row. Memoized: it re-renders only when its own states or its tab stop change (not on a search keystroke elsewhere or a note). */
const MatrixRow = memo(function MatrixRow({ member, r, cols, states, activeC }: RowProps) {
  const roles = rolesOf(member);
  let c = -1;
  return (
    <tr data-member={member.uid}>
      <th scope="row" className={cn(PINNED, "min-w-[10.5rem] max-w-[14rem] px-3 py-1.5 text-left font-medium")}>
        <div className="truncate">{member.name}</div>
        <div className="flex flex-wrap gap-1 pt-0.5">
          {member.isOwner || member.isAdmin ? <span className="rounded-full border border-[var(--glass-border)] px-1.5 text-[10px] text-[var(--muted-foreground)]">{member.isOwner ? "Owner" : "Admin"}</span> : null}
          {roles.map((id) => (
            <span key={id} className={cn("whitespace-nowrap rounded-full px-1.5 text-[10px] font-normal", getRole(id).className)}>
              {getRole(id).label}
            </span>
          ))}
        </div>
      </th>
      {cols.map((slot) => {
        if (slot.kind === "collapsed") return <td key={`x-${slot.groupId}`} className="w-11 min-w-11 p-0" aria-hidden />;
        c++;
        const state = states[c];
        const idx = c;
        const label = cellLabel(member.name, slot.col.row.title, state, slot.col.row.kind === "admin");
        return (
          <td key={slot.col.row.id} className="w-11 min-w-11 p-0 text-center">
            <button
              type="button"
              data-cell
              data-uid={member.uid}
              data-page={slot.col.row.id}
              data-r={r}
              data-c={idx}
              data-state={state.kind}
              tabIndex={activeC === idx ? 0 : -1}
              aria-label={label}
              title={label}
              className={cn(
                "mx-auto my-0.5 flex h-9 w-9 items-center justify-center rounded-lg border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.7)] pointer-coarse:h-11 pointer-coarse:w-11",
                KIND_STYLE[state.kind]
              )}
            >
              <CellIcon kind={state.kind} />
            </button>
          </td>
        );
      })}
    </tr>
  );
});

type Props = {
  config: PageAccessConfig;
  /** The team's ACTIVE members only. */
  members: TeamMember[];
  groups: AccessPageGroup[];
  onSetMemberPage: (member: TeamMember, pageId: string, state: MemberPageState) => void;
  /** "Open this role in Roles": the panel switches to the Roles tab and points at the role. */
  onOpenRole: (role: RoleId) => void;
};

export function MembersMatrix({ config, members, groups, onSetMemberPage, onOpenRole }: Props) {
  const [memberQuery, setMemberQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | RoleId>("all");
  const [colQuery, setColQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [note, setNote] = useState<Note | null>(null);
  const [active, setActive] = useState({ r: 0, c: 0 });
  const [limit, setLimit] = useState(ROW_WINDOW);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  const searchingCols = colQuery.trim() !== "";
  const visibleGroups = useMemo(() => filterGroups(groups, colQuery), [groups, colQuery]);

  // Columns, in sidebar group order. A collapsed group keeps ONE narrow slot (its header button) and hides its pages.
  const slots = useMemo<Slot[]>(
    () => visibleGroups.flatMap((g): Slot[] => (!searchingCols && collapsed.has(g.id) ? [{ kind: "collapsed", groupId: g.id }] : g.rows.map((row) => ({ kind: "col" as const, col: { row, groupId: g.id } })))),
    [visibleGroups, collapsed, searchingCols]
  );
  const cols = useMemo(() => slots.flatMap((s) => (s.kind === "col" ? [s.col] : [])), [slots]);

  const sorted = useMemo(() => [...members].sort((a, b) => a.name.localeCompare(b.name)), [members]);
  const filtered = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    return sorted.filter((m) => (!q || m.name.toLowerCase().includes(q)) && (roleFilter === "all" || rolesOf(m).includes(roleFilter)));
  }, [sorted, memberQuery, roleFilter]);
  const shownMembers = useMemo(() => filtered.slice(0, limit), [filtered, limit]);

  // Effective access once per member and page. Recomputed only when the people, the columns or the stored config change.
  const states = useMemo(() => shownMembers.map((m) => cols.map((c) => cellState(asAccessUser(m), c.row, config))), [shownMembers, cols, config]);

  const memberByUid = useMemo(() => new Map(members.map((m) => [m.uid, m])), [members]);
  const rowById = useMemo(() => new Map(groups.flatMap((g) => g.rows).map((r) => [r.id, r])), [groups]);

  const toggleGroup = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const explain = useCallback(
    (member: TeamMember, row: AccessPageRow, state: CellState) => {
      const key = `${member.uid}:${row.id}`;
      if (state.kind === "role" && state.admin) setNote({ key, text: `${member.name} is ${member.isOwner ? "the owner" : "an admin"}, so they can open every page. Admin access comes with the admin setting, not a role.` });
      else if (state.kind === "role") {
        const names = state.roles.map((r) => getRole(r).label).join(", ");
        setNote({ key, text: `${member.name} opens ${row.title} through the role ${names}. A role's pages are changed in Roles, not here.`, roleLink: state.roles[0] });
      } else if (state.kind === "open") setNote({ key, text: `${row.title} is open to everyone by default. To close it for a role, untick that role in Roles.` });
      else if (state.kind === "blocked") setNote({ key, text: `${row.title} is blocked for ${member.name} on its own, even where a role would open it.`, unblock: { uid: member.uid, pageId: row.id } });
      else if (row.kind === "admin") setNote({ key, text: `${row.title} is for admins only. It can't be given to a member.` });
    },
    []
  );

  const onCellClick = (e: MouseEvent<HTMLTableSectionElement>) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-cell]");
    if (!button) return;
    const member = memberByUid.get(button.dataset.uid ?? "");
    const row = rowById.get(button.dataset.page ?? "");
    if (!member || !row) return;
    setActive({ r: Number(button.dataset.r), c: Number(button.dataset.c) });
    const state = cellState(asAccessUser(member), row, config);
    const action = cellAction(state, row);
    if (action.type === "grant") {
      setNote(null);
      onSetMemberPage(member, row.id, "grant");
    } else if (action.type === "remove") {
      setNote(null);
      onSetMemberPage(member, row.id, "default");
    } else if (action.type === "explain") explain(member, row, state);
    else if (row.reason) setNote({ key: `${member.uid}:${row.id}`, text: row.reason });
  };

  // Arrow keys move between cells; one cell holds the tab stop (a 60 x 40 table must not be 2,400 tab stops).
  const onKeyDown = (e: KeyboardEvent<HTMLTableSectionElement>) => {
    const target = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-cell]");
    if (!target) return;
    let r = Number(target.dataset.r);
    let c = Number(target.dataset.c);
    if (e.key === "ArrowRight") c += 1;
    else if (e.key === "ArrowLeft") c -= 1;
    else if (e.key === "ArrowDown") r += 1;
    else if (e.key === "ArrowUp") r -= 1;
    else if (e.key === "Home") c = 0;
    else if (e.key === "End") c = cols.length - 1;
    else return;
    e.preventDefault();
    r = Math.max(0, Math.min(shownMembers.length - 1, r));
    c = Math.max(0, Math.min(cols.length - 1, c));
    setActive({ r, c });
    bodyRef.current?.querySelector<HTMLButtonElement>(`button[data-r="${r}"][data-c="${c}"]`)?.focus();
  };

  const colCount = slots.length;
  const activeR = Math.min(active.r, Math.max(0, shownMembers.length - 1));
  const activeC = Math.min(active.c, Math.max(0, cols.length - 1));
  const roleLink = note?.roleLink;
  const unblock = note?.unblock;
  const filterLabel = roleFilter === "all" ? "All roles" : getRole(roleFilter).label;

  return (
    <div className="flex flex-col gap-3" data-testid="members-matrix-wrap">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="sm:w-60">
          <label htmlFor="mm-member-search" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            Find a member
          </label>
          <Input id="mm-member-search" type="search" value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder="Name" data-testid="mm-member-search" />
        </div>
        <div className="sm:w-52">
          <label htmlFor="mm-role-filter" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            Role
          </label>
          <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as "all" | RoleId)}>
            <SelectTrigger id="mm-role-filter" data-testid="mm-role-filter">
              <SelectValue>{filterLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              {ROLES.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:w-60">
          <label htmlFor="mm-page-search" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            Find a page
          </label>
          <Input id="mm-page-search" type="search" value={colQuery} onChange={(e) => setColQuery(e.target.value)} placeholder="Page or group" data-testid="mm-page-search" />
        </div>
      </div>

      <Legend />
      <p className="text-xs text-[var(--muted-foreground)] md:hidden" data-testid="matrix-phone-note">
        This chart scrolls sideways. For a simpler view, switch back and use the Member dropdown.
      </p>

      <p role="status" aria-live="polite" className={cn("glass-card flex flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between", !note && "hidden")} data-testid="matrix-note">
        {note && (
          <>
            <span>{note.text}</span>
            <span className="flex shrink-0 gap-2">
              {roleLink && (
                <Button size="sm" variant="glass" onClick={() => onOpenRole(roleLink)} data-testid="matrix-note-role-link">
                  Open {getRole(roleLink).label} in Roles
                </Button>
              )}
              {unblock && (
                <Button
                  size="sm"
                  variant="glass"
                  onClick={() => {
                    const m = memberByUid.get(unblock.uid);
                    if (m) onSetMemberPage(m, unblock.pageId, "default");
                    setNote(null);
                  }}
                  data-testid="matrix-note-unblock"
                >
                  Remove the block
                </Button>
              )}
              <Button size="sm" variant="glass" onClick={() => setNote(null)}>
                Close
              </Button>
            </span>
          </>
        )}
      </p>

      <div className="table-shell max-h-[70dvh] overflow-auto overscroll-x-contain p-0" data-testid="members-matrix">
        <table className="border-collapse text-left text-sm" aria-label="Page access for all members">
          <thead className="text-xs text-[var(--muted-foreground)]">
            <tr>
              <th scope="col" rowSpan={2} className={cn(HEAD, "left-0 z-30 min-w-[10.5rem] px-3 py-3 text-left font-medium uppercase tracking-wide align-bottom")}>
                Member
                <span className="block text-[10px] font-normal normal-case">
                  {filtered.length} of {members.length}
                </span>
              </th>
              {visibleGroups.map((g) => {
                const isCollapsed = !searchingCols && collapsed.has(g.id);
                return (
                  <th key={g.id} scope="colgroup" colSpan={isCollapsed ? 1 : g.rows.length} className={cn(HEAD, "h-11 border-l border-[var(--glass-border)] p-0 text-left")} data-group={g.id}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(g.id)}
                      aria-expanded={!isCollapsed}
                      aria-label={`${g.label} group, ${isCollapsed ? "collapsed" : "expanded"}`}
                      title={g.label}
                      className="flex h-11 w-full items-center gap-1 px-2 text-xs font-semibold uppercase tracking-wide outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgba(var(--glow),0.5)]"
                    >
                      {isCollapsed ? <ChevronRight className="h-4 w-4 shrink-0" aria-hidden /> : <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />}
                      {!isCollapsed && <span className="truncate">{g.label}</span>}
                    </button>
                  </th>
                );
              })}
            </tr>
            <tr>
              {slots.map((s) =>
                s.kind === "collapsed" ? (
                  <th key={`x-${s.groupId}`} scope="col" className={cn(HEAD, "top-11 w-11 min-w-11 border-l border-[var(--glass-border)]")}>
                    <span className="sr-only">Collapsed group</span>
                  </th>
                ) : (
                  <th key={s.col.row.id} scope="col" title={s.col.row.title} data-page={s.col.row.id} className={cn(HEAD, "top-11 h-36 w-11 min-w-11 p-0 font-medium")}>
                    <span className="mx-auto block max-h-36 overflow-hidden whitespace-nowrap py-2 text-xs [text-orientation:mixed] [writing-mode:vertical-rl] rotate-180">{s.col.row.title}</span>
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody ref={bodyRef} className="divide-y divide-[var(--glass-border)]" onClick={onCellClick} onKeyDown={onKeyDown}>
            {shownMembers.length === 0 && (
              <tr>
                <td colSpan={colCount + 1} className="px-4 py-6 text-center text-sm text-[var(--muted-foreground)]" data-testid="matrix-empty">
                  {members.length === 0 ? "No active members on this team yet." : "No member matches these filters."}
                </td>
              </tr>
            )}
            {shownMembers.map((m, r) => (
              <MatrixRow key={m.uid} member={m} r={r} cols={slots} states={states[r]} activeC={r === activeR ? activeC : -1} />
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > shownMembers.length && (
        <div className="flex justify-center">
          <Button variant="glass" onClick={() => setLimit((n) => n + ROW_WINDOW)} data-testid="matrix-show-more">
            Show {Math.min(ROW_WINDOW, filtered.length - shownMembers.length)} more of {filtered.length - shownMembers.length} members
          </Button>
        </div>
      )}
      {cols.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">No page matches &ldquo;{colQuery.trim()}&rdquo;.</p>}
    </div>
  );
}
