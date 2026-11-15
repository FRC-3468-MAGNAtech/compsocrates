"use client";

import { useState } from "react";
import { Loader2, Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input, Label } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { MAX_ACCOUNT_TEAMS, MAX_ACCOUNT_TEAM_NAME, effectiveTeamIds, newAccountTeamId, removalCheck, sameIds, sanitizeTeamName, toggleAssignment, upsertTeam, validateAccountTeams } from "@/lib/account-teams";
import { usePermissions } from "@/lib/permissions";
import { useProgramData } from "@/lib/program/data";
import { useTeamDoc } from "@/lib/team";
import { useTeamMembers } from "@/lib/team-members";
import { parseTeamNumber, teamLabel, type AccountTeam } from "@/lib/team-number";

const SAVE_FAILED = "Couldn't save the change. You may not have permission, or the connection dropped. Nothing was changed.";

type Editing = { id: string | null; number: string; name: string };

/**
 * Team Settings for a program where one account scouts for several teams (`ProgramConfig.multiTeam`): the account's teams (add, rename, remove) and which
 * members are assigned to which. Everyone reads the list; only an admin or owner edits (the rules enforce it too). Every change is one batch with its audit entry.
 * A member sees only their assigned teams in the switcher and an admin sees all (`lib/our-team.ts`); a member with no assignment counts as every team.
 * Entries belong to the account, not to a team, so removing a team never touches one; it is refused while a member is still assigned to it.
 */
export function AccountTeamsSection() {
  const { user, profile } = useAuth();
  const { isAdmin, isOwner } = usePermissions();
  const canEdit = isAdmin || isOwner;
  const port = useProgramData();
  const teamId = profile?.teamId ?? null;
  const { team, loaded } = useTeamDoc(teamId);
  const { members, loaded: membersLoaded, error: membersError } = useTeamMembers(teamId);
  const teams: AccountTeam[] = team?.accountTeams ?? [];

  const [editing, setEditing] = useState<Editing | null>(null);
  const [removing, setRemoving] = useState<AccountTeam | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookupNote, setLookupNote] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);

  const actor = user && profile && teamId ? { teamId, uid: user.uid, name: profile.name } : null;

  if (!loaded || !teamId) return <div className="glass-card h-32 animate-pulse" />;
  if (!team) {
    return (
      <GlassPanel data-testid="account-teams">
        <p role="alert" className="text-sm font-medium text-red-300">
          Couldn&apos;t load your teams. Reload the page; if it keeps happening, check your connection.
        </p>
      </GlassPanel>
    );
  }

  const editingNumber = editing ? parseTeamNumber(editing.number) : null;
  const draftTeam: AccountTeam | null = editing && editingNumber !== null ? { id: editing.id ?? "new", number: editingNumber, name: sanitizeTeamName(editing.name) || null } : null;
  const draftProblems = editing ? (draftTeam ? validateAccountTeams(upsertTeam(teams, draftTeam)) : ["Enter a team number with 1 to 5 digits."]) : [];
  const atLimit = teams.length >= MAX_ACCOUNT_TEAMS;
  // An admin sees every team whatever is stored on their row, so only non-admins can block a removal.
  const assignable = members.filter((m) => !m.isAdmin);

  const run = async (write: () => Promise<void>): Promise<boolean> => {
    if (!port || !actor) return false;
    setBusy(true);
    setError(null);
    try {
      await write();
      return true;
    } catch {
      setError(SAVE_FAILED);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveEditing = async () => {
    if (!port || !actor || !editing || !draftTeam || draftProblems.length > 0) return;
    const isNew = editing.id === null;
    const saved: AccountTeam = { ...draftTeam, id: editing.id ?? newAccountTeamId() };
    const before = teams.find((t) => t.id === saved.id) ?? null;
    const next = upsertTeam(teams, saved);
    const ok = await run(() =>
      port.team.saveAccountTeams(actor, { teams: next, assignments: [], action: "edit-account-teams", target: { change: isNew ? "add" : "edit", teamId: saved.id, number: saved.number }, before, after: saved })
    );
    if (ok) {
      setEditing(null);
      setLookupNote(null);
    }
  };

  const confirmRemove = async () => {
    if (!port || !actor || !removing) return;
    const check = removalCheck(removing.id, teams, assignable);
    if (!check.ok) return;
    const next = teams.filter((t) => t.id !== removing.id);
    const ok = await run(() => port.team.saveAccountTeams(actor, { teams: next, assignments: [], action: "edit-account-teams", target: { change: "remove", teamId: removing.id, number: removing.number }, before: removing, after: null }));
    if (ok) setRemoving(null);
  };

  const lookup = async () => {
    if (!port || !editing || editingNumber === null || !teamId) return;
    setLooking(true);
    setLookupNote(null);
    try {
      const out = await port.team.lookupTeamName(teamId, editingNumber);
      if (out.found && out.name) {
        setEditing((e) => (e ? { ...e, name: out.name ?? e.name } : e));
        setLookupNote("Name filled in from the events API. Edit it if you like.");
      } else {
        setLookupNote("No team with that number was found. Type the name yourself.");
      }
    } catch (err) {
      setLookupNote(`${err instanceof Error && err.message ? err.message : "Couldn't look the team up."} You can still type the name yourself.`);
    } finally {
      setLooking(false);
    }
  };

  const toggleMember = async (uid: string, current: readonly string[] | undefined, teamKey: string, on: boolean) => {
    if (!port || !actor) return;
    const next = toggleAssignment(current, teamKey, on, teams);
    if (!next) return;
    const before = effectiveTeamIds(current, teams);
    if (sameIds(before, next)) return;
    setAssigning(uid);
    setAssignError(null);
    try {
      // The team list rides along (unchanged): the rules check an assignment against the team doc's own id list, which an account that predates the list lacks.
      await port.team.saveAccountTeams(actor, { teams, assignments: [{ uid, assignedTeamIds: next }], action: "edit-member-teams", target: { targetUid: uid }, before, after: next });
    } catch {
      setAssignError(SAVE_FAILED);
    } finally {
      setAssigning(null);
    }
  };

  const removeCheck = removing ? removalCheck(removing.id, teams, assignable) : null;

  return (
    <GlassPanel className="flex flex-col gap-4" data-testid="account-teams">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          <Users className="h-4 w-4" /> Teams
        </h2>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          {canEdit
            ? "The teams your account scouts for. A member sees only the teams they are assigned to; admins see all. Scouting entries belong to the account, so they are never tied to one of these."
            : "The teams your account scouts for. An admin can change them."}
        </p>
      </div>

      {teams.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No teams yet.{canEdit ? " Add the first one below." : ""}</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Teams">
          {teams.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--glass-border)] px-4 py-2.5">
              <span className="text-sm font-medium">{teamLabel(t.number, t.name)}</span>
              {canEdit && (
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" aria-label={`Edit ${teamLabel(t.number)}`} onClick={() => { setError(null); setLookupNote(null); setEditing({ id: t.id, number: String(t.number), name: t.name ?? "" }); }}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Remove ${teamLabel(t.number)}`} onClick={() => { setError(null); setRemoving(t); }}>
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="glass" disabled={atLimit} onClick={() => { setError(null); setLookupNote(null); setEditing({ id: null, number: "", name: "" }); }} className="gap-2">
            <Plus className="h-4 w-4" /> Add a team
          </Button>
          {atLimit && <span className="text-xs text-[var(--muted-foreground)]">An account can have at most {MAX_ACCOUNT_TEAMS} teams.</span>}
        </div>
      )}

      {canEdit && (
        <div className="flex flex-col gap-2" data-testid="member-teams">
          <h3 className="text-sm font-semibold">Who sees which team</h3>
          <p className="text-xs text-[var(--muted-foreground)]">Tick the teams each member can switch to. A member with none ticked yet sees every team. Admins always see every team.</p>
          {!membersLoaded ? (
            <div className="glass-card h-16 animate-pulse" />
          ) : membersError ? (
            <p role="alert" className="text-sm font-medium text-red-300">
              Couldn&apos;t load the members. {membersError.message}
            </p>
          ) : members.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No members yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {members.map((m) => {
                const mine = effectiveTeamIds(m.assignedTeamIds, teams);
                const unset = !m.assignedTeamIds || m.assignedTeamIds.length === 0;
                return (
                  <li key={m.uid} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--glass-border)] px-4 py-2.5">
                    <span className="min-w-0 text-sm">
                      <span className="font-medium">{m.name}</span>
                      {m.isAdmin && <span className="ml-2 text-xs text-[var(--muted-foreground)]">Admin: sees every team</span>}
                      {!m.isAdmin && unset && <span className="ml-2 text-xs text-[var(--muted-foreground)]">All teams</span>}
                    </span>
                    {!m.isAdmin && (
                      <span className="flex flex-wrap items-center gap-4">
                        {teams.map((t) => (
                          <label key={t.id} className="flex items-center gap-2 text-sm">
                            <Checkbox checked={mine.includes(t.id)} disabled={assigning === m.uid || (mine.length === 1 && mine[0] === t.id)} onCheckedChange={(v) => toggleMember(m.uid, m.assignedTeamIds, t.id, v === true)} aria-label={`${m.name}: ${teamLabel(t.number)}`} />
                            {t.number}
                          </label>
                        ))}
                        {assigning === m.uid && <Loader2 className="h-4 w-4 animate-spin" aria-label="Saving" />}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {assignError && (
            <p role="alert" className="text-sm font-medium text-red-300">
              {assignError}
            </p>
          )}
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(next) => !busy && !next && setEditing(null)}>
        <DialogContent className="glass-overlay w-[min(94vw,480px)]">
          <DialogTitle>{editing?.id ? "Edit team" : "Add a team"}</DialogTitle>
          <DialogDescription>A team number has 1 to 5 digits. The name is optional.</DialogDescription>
          {editing && (
            <div className="mt-4 flex flex-col gap-4">
              <div>
                <Label htmlFor="account-team-number">Team number</Label>
                <div className="flex gap-2">
                  <Input id="account-team-number" inputMode="numeric" maxLength={5} value={editing.number} disabled={busy} onChange={(e) => { setEditing({ ...editing, number: e.target.value.replace(/\D/g, "") }); setLookupNote(null); }} />
                  <Button variant="glass" onClick={lookup} disabled={busy || looking || editingNumber === null} className="shrink-0 gap-2">
                    {looking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Look up
                  </Button>
                </div>
              </div>
              <div>
                <Label htmlFor="account-team-name">Team name</Label>
                <Input id="account-team-name" maxLength={MAX_ACCOUNT_TEAM_NAME} value={editing.name} disabled={busy} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                {lookupNote && (
                  <p role="status" className="mt-1 text-xs text-[var(--muted-foreground)]">
                    {lookupNote}
                  </p>
                )}
              </div>
              {editing.number !== "" && draftProblems.length > 0 && (
                <p role="alert" className="text-xs text-red-300">
                  {draftProblems[0]}
                </p>
              )}
              {error && (
                <p role="alert" className="text-sm font-medium text-red-300">
                  {error}
                </p>
              )}
            </div>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={saveEditing} disabled={busy || !draftTeam || draftProblems.length > 0} className="min-w-28 gap-2">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(next) => !busy && !next && setRemoving(null)}>
        <DialogContent className="glass-overlay w-[min(94vw,480px)]">
          <DialogTitle>Remove {removing ? teamLabel(removing.number, removing.name) : "team"}?</DialogTitle>
          {removeCheck && removeCheck.ok && (
            <DialogDescription>No member is assigned to this team. Scouting entries are not tied to it, so they all stay as they are. The change is recorded in the audit log.</DialogDescription>
          )}
          {removeCheck && !removeCheck.ok && removeCheck.reason === "last-team" && <DialogDescription>An account needs at least one team, so the last one cannot be removed.</DialogDescription>}
          {removeCheck && !removeCheck.ok && removeCheck.reason === "assigned" && (
            <div className="mt-2 text-sm" role="alert">
              <p>
                {removeCheck.members.length} {removeCheck.members.length === 1 ? "member is" : "members are"} still assigned to this team, so it cannot be removed yet: {removeCheck.members.map((m) => m.name).join(", ")}. Untick it for them under &ldquo;Who sees which team&rdquo; first.
              </p>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm font-medium text-red-300">
              {error}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRemoving(null)} disabled={busy}>
              {removeCheck && removeCheck.ok ? "Cancel" : "Close"}
            </Button>
            {removeCheck && removeCheck.ok && (
              <Button variant="danger" onClick={confirmRemove} disabled={busy} className="min-w-28 gap-2">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Remove
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {error && !editing && !removing && (
        <p role="alert" className="text-sm font-medium text-red-300">
          {error}
        </p>
      )}
    </GlassPanel>
  );
}
