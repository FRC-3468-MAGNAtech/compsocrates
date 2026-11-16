"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Lock } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { rolePageCount, type PageAccessConfig } from "@/lib/page-access/access";
import { filterGroups, type AccessPageGroup } from "@/lib/page-access/page-list";
import { ROLES, type RoleId } from "@/lib/roles";
import { cn } from "@/lib/utils";

// Session 6: the Roles chart. Rows are EVERY page of the program (grouped like the sidebar), columns the roles. A ticked box means that role (primary or secondary)
// can open the page. Open pages start fully ticked ("Open to everyone by default") and stay customizable; always-on pages are ticked and locked; the Admin Panel
// is admins only. What a person can open is still decided by lib/page-access/access.ts, never here. Shared by every program: it gets its pages as `groups`.

/** The pinned first column and the sticky header use the solid Session 2 surfaces (no backdrop blur). */
export const PINNED = "table-pinned-cell sticky left-0 z-10";
export const HEAD = "table-head-cell sticky top-0 z-20";

type Props = {
  config: PageAccessConfig;
  groups: AccessPageGroup[];
  /** Tick or untick a restricted page for a role. */
  onToggle: (role: RoleId, pageId: string, on: boolean) => void;
  /** Close (`restricted` true) or re-open an open page for a role. */
  onToggleOpen: (role: RoleId, pageId: string, restricted: boolean) => void;
  disabled?: boolean;
  /** A role to point at (the All Members matrix links here). */
  highlightRole?: RoleId | null;
};

export function RoleMatrix({ config, groups, onToggle, onToggleOpen, disabled, highlightRole }: Props) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const shown = useMemo(() => filterGroups(groups, query), [groups, query]);
  const searching = query.trim() !== "";
  const toggleGroup = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const emptyRoles = ROLES.filter((r) => rolePageCount(config, r.id) === 0);

  return (
    <div className="flex flex-col gap-3" data-testid="role-matrix-wrap">
      <div className="max-w-sm">
        <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search pages" aria-label="Search pages" data-testid="role-matrix-search" />
      </div>

      {emptyRoles.length > 0 && (
        <ul className="flex flex-col gap-1" data-testid="role-empty-warning">
          {emptyRoles.map((r) => (
            <li key={r.id} role="status" className="flex items-start gap-2 text-sm text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {r.label} has no pages beyond the always-available ones. That is allowed, but members with only this role will see very little.
            </li>
          ))}
        </ul>
      )}

      <div className="table-shell max-h-[70dvh] overflow-auto p-0" data-testid="role-matrix">
        <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
            <tr>
              <th scope="col" className={cn(HEAD, "left-0 z-30 min-w-[13rem] px-3 py-3 font-medium")}>
                Page
              </th>
              {ROLES.map((r) => (
                <th key={r.id} scope="col" data-role={r.id} className={cn(HEAD, "px-2 py-3 text-center font-medium", highlightRole === r.id && "ring-2 ring-inset ring-[rgba(var(--glow),0.6)]")}>
                  <span className={cn("inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] normal-case", r.className)}>{r.label}</span>
                  {rolePageCount(config, r.id) === 0 && <AlertTriangle className="mx-auto mt-1 h-3.5 w-3.5 text-amber-300" aria-label={`${r.label} has no pages beyond the always-available ones`} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--glass-border)]">
            {shown.length === 0 && (
              <tr>
                <td colSpan={ROLES.length + 1} className="px-4 py-6 text-center text-sm text-[var(--muted-foreground)]">
                  No page matches &ldquo;{query.trim()}&rdquo;.
                </td>
              </tr>
            )}
            {shown.map((group) => {
              const open = searching || !collapsed.has(group.id);
              return [
                <tr key={`g-${group.id}`} data-group={group.id}>
                  <th scope="colgroup" colSpan={ROLES.length + 1} className="table-pinned-cell px-0 py-0 text-left">
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.id)}
                      aria-expanded={open}
                      className="flex min-h-11 w-full items-center gap-2 px-3 text-xs font-semibold uppercase tracking-wide outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgba(var(--glow),0.5)]"
                    >
                      {open ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
                      {group.label}
                      <span className="font-normal normal-case text-[var(--muted-foreground)]">({group.rows.length})</span>
                    </button>
                  </th>
                </tr>,
                ...(open
                  ? group.rows.map((row) => (
                      <tr key={row.id} data-page={row.id} data-kind={row.kind}>
                        <th scope="row" className={cn(PINNED, "px-3 py-2.5 text-left font-medium")}>
                          <div>{row.title}</div>
                          {row.kind === "open" && <div className="text-xs font-normal text-[var(--muted-foreground)]">Open to everyone by default</div>}
                          {(row.kind === "always" || row.kind === "admin") && (
                            <div className="flex items-start gap-1 text-xs font-normal text-[var(--muted-foreground)]">
                              <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> {row.reason}
                            </div>
                          )}
                        </th>
                        {row.kind === "admin" ? (
                          <td colSpan={ROLES.length} className="px-3 py-2 text-center text-xs text-[var(--muted-foreground)]">
                            Admins only, never given to a role
                          </td>
                        ) : (
                          ROLES.map((r) => {
                            const locked = row.kind === "always";
                            const checked = row.kind === "restricted" ? (config.roleGrants[r.id] ?? []).includes(row.id) : locked ? true : !config.openRestrictions?.[r.id]?.includes(row.id);
                            return (
                              <td key={r.id} className="px-2 py-1.5 text-center">
                                <Checkbox
                                  checked={checked}
                                  disabled={disabled || locked}
                                  onCheckedChange={(v) => (row.kind === "restricted" ? onToggle(r.id, row.id, v === true) : onToggleOpen(r.id, row.id, v !== true))}
                                  aria-label={`${r.label} can open ${row.title}${locked ? " (always available, locked)" : row.kind === "open" ? " (open to everyone by default)" : ""}`}
                                  data-testid={`matrix-${r.id}-${row.id}`}
                                  className={cn("mx-auto h-7 w-7 pointer-coarse:h-11 pointer-coarse:w-11", locked && "opacity-60")}
                                />
                              </td>
                            );
                          })
                        )}
                      </tr>
                    ))
                  : []),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
