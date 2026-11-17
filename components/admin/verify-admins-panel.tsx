"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input, Label } from "@/components/ui/input";
import { membershipApi, type AdminToVerifyRow } from "@/lib/memberships/client";
import { friendlyMembershipError, MEMBERSHIP_TEXT } from "@/lib/memberships/strings";
import { useProgram } from "@/lib/program/context";
import { getRole, normalizeLegacyRole } from "@/lib/roles";

const T = MEMBERSHIP_TEXT.verify;

const REASONS: Record<string, string> = {
  not_admin_anymore: "no longer an admin of this team",
  wrong_team: "not on this team",
  not_found: "not found",
  not_active: "no longer an active member",
};

/**
 * Admin Panel > Verify admins (platform owner only, the same tab in every program, shown only while the memberships switch is ON). An existing admin's admin flag cannot be
 * proved from data (a person can often write it on their own account), so a team's admins start "not verified" and cannot read the past roster. The owner picks a team,
 * reviews each admin and the evidence note, ticks the ones they know (NOBODY is ticked for them), types the team's name, and the server re-checks each person before it
 * verifies them. Step one only reads; nothing changes until the confirmation matches.
 */
export function VerifyAdminsPanel() {
  const program = useProgram();
  const [teamId, setTeamId] = useState("");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [admins, setAdmins] = useState<AdminToVerifyRow[] | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<"list" | "verify" | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [skipped, setSkipped] = useState<{ uid: string; reason: string }[]>([]);

  const list = async () => {
    const id = teamId.trim();
    if (!id) return;
    setBusy("list");
    setNote(null);
    setSkipped([]);
    try {
      const res = await membershipApi.listAdmins(program, id);
      setAdmins(res.admins);
      setConfirmName(res.confirmName);
      setLoadedFor(id);
      setTicked(new Set());
      setTyped("");
    } catch (err) {
      setAdmins(null);
      setLoadedFor(null);
      setNote({ kind: "error", text: friendlyMembershipError(err, "Couldn't list that team's admins.") });
    } finally {
      setBusy(null);
    }
  };

  const verify = async () => {
    if (!loadedFor || ticked.size === 0) return;
    setBusy("verify");
    setNote(null);
    try {
      const res = await membershipApi.verifyAdmins(program, { teamId: loadedFor, uids: [...ticked], confirmName: typed });
      setSkipped(res.skipped);
      setNote({ kind: "ok", text: T.result(res.verified.length) });
      // The list is read again so the origins on screen are the stored ones.
      const fresh = await membershipApi.listAdmins(program, loadedFor);
      setAdmins(fresh.admins);
      setTicked(new Set());
      setTyped("");
    } catch (err) {
      setNote({ kind: "error", text: friendlyMembershipError(err, "Couldn't verify those admins.") });
    } finally {
      setBusy(null);
    }
  };

  const toggle = (uid: string, on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(uid);
      else next.delete(uid);
      return next;
    });

  const canVerify = busy === null && ticked.size > 0 && typed.trim() !== "";

  return (
    <GlassPanel className="flex flex-col gap-4" data-testid="verify-admins-panel">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          <ShieldCheck className="h-4 w-4" /> {T.heading}
        </h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">{T.intro}</p>
      </div>

      <form
        className="flex flex-col gap-2 sm:max-w-md"
        onSubmit={(e) => {
          e.preventDefault();
          void list();
        }}
      >
        <Label htmlFor="verify-team-id">{T.teamLabel}</Label>
        <div className="flex gap-2">
          <Input id="verify-team-id" value={teamId} onChange={(e) => setTeamId(e.target.value)} autoCapitalize="characters" autoComplete="off" />
          <Button type="submit" variant="glass" className="min-h-11 shrink-0" disabled={busy !== null || teamId.trim() === ""}>
            {busy === "list" ? "Loading…" : T.load}
          </Button>
        </div>
      </form>

      {note && (
        <p role={note.kind === "error" ? "alert" : "status"} className={note.kind === "error" ? "text-sm text-red-300" : "text-sm text-emerald-300"}>
          {note.text}
        </p>
      )}
      {skipped.length > 0 && (
        <p className="text-xs text-[var(--muted-foreground)]">
          {T.skipped}: {skipped.map((s) => `${s.uid} (${REASONS[s.reason] ?? s.reason})`).join(", ")}
        </p>
      )}

      {admins !== null &&
        (admins.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">{T.none}</p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {admins.map((a) => {
                const role = getRole(a.role ? normalizeLegacyRole(a.role) : "match-scout");
                return (
                  <li key={a.uid} className="glass-card flex items-start gap-3 p-4" data-testid={`verify-row-${a.uid}`}>
                    <Checkbox
                      className="mt-0.5 h-6 w-6"
                      checked={ticked.has(a.uid)}
                      onCheckedChange={(v) => toggle(a.uid, v === true)}
                      disabled={busy !== null || a.membership === "verified"}
                      aria-label={`Verify ${a.name || a.uid}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{a.name || "Unnamed"}</span>
                        <Badge className={role.className}>{role.label}</Badge>
                        {a.isOwner && <Badge variant="glass" className="text-[10px]">Owner</Badge>}
                        {a.isAdmin && !a.isOwner && <Badge variant="glass" className="text-[10px]">Admin</Badge>}
                        <Badge variant="glass" className="text-[10px]">
                          {T.membership[a.membership]}
                        </Badge>
                      </div>
                      <div className="mt-1 break-all text-[11px] text-[var(--muted-foreground)]">{a.uid}</div>
                      <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                        {T.evidence}: {a.evidence}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-col gap-2 sm:max-w-md">
              <Label htmlFor="verify-confirm">{T.confirmLabel(confirmName)}</Label>
              <Input id="verify-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
              <Button className="min-h-11 gap-2 self-start" disabled={!canVerify} onClick={() => void verify()}>
                <ShieldCheck className="h-4 w-4" /> {busy === "verify" ? "Verifying…" : T.submit}
              </Button>
            </div>
          </>
        ))}
    </GlassPanel>
  );
}
