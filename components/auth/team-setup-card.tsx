"use client";

import { useState } from "react";
import { DEFAULT_ROLE_ID, getRole, ROLES, type RoleId } from "@/lib/roles";
import { TEAM_CREATION_CLOSED_TEXT, validateJoin } from "@/lib/team-setup";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isRequestableRole } from "@/lib/memberships/flows";
import { MEMBERSHIP_TEXT } from "@/lib/memberships/strings";

type Mode = "join" | "apply";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs text-red-400">
      {message}
    </p>
  );
}

export type TeamSetupCardProps = {
  /** The program's short name for the heading ("Set up your <label> team"); omitted, the heading says "your team". */
  programLabel?: string;
  greeting?: string;
  /** Are applications open (`appSettings/global.teamCreationEnabled`)? `loading`: not known yet (the Apply tab waits). `closed`: the Apply tab shows the closed notice. */
  applications: "open" | "closed" | "loading";
  /** The name sent with a join request: the account's own name (shown in, and editable on, the join form). */
  defaultName: string;
  /** Replaces the heading and the line under it (a person who already has a team asking to join another). */
  heading?: string;
  description?: string;
  /** A line above the form (for example, why the last request was closed). */
  notice?: string | null;
  /** Sends a join request. Throw an Error with the words to show if it fails. Resolve once it is sent; the caller then replaces the card. */
  onJoin: (input: { code: string; name: string; role?: RoleId }) => Promise<void>;
  /**
   * Memberships ON only: asks the server about a typed code BEFORE the request is sent (the server answers just `{ exists, allowsRoleChoice, alreadyMember, atLimit }`).
   * When the team lets joiners choose, a role select appears and the person sends again. Absent (kill switch OFF): the join form is exactly as it always was.
   */
  joinLookup?: (code: string) => Promise<{ exists: boolean; allowsRoleChoice: boolean; alreadyMember: boolean; atLimit: boolean }>;
  /** The person asked to go on to the application. */
  onApply: () => void;
  /** The tab shown first (default Join). For tests, which render each tab statically. */
  initialMode?: "join" | "apply";
};

/**
 * THE team setup card, for every program: Join a team first, Apply for a team second, one card (it is only ever rendered by `TeamSetupScreen`). The Join form is a
 * join code and your name; the Apply tab explains the application and goes on to it, or says applications are closed. The program supplies nothing but its label.
 */
export function TeamSetupCard({ programLabel, greeting, heading, description, applications, defaultName, notice, onJoin, joinLookup, onApply, initialMode = "join" }: TeamSetupCardProps) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [joinCode, setJoinCode] = useState("");
  const [displayName, setDisplayName] = useState(defaultName);
  // Memberships ON: the code the server said lets joiners choose a role, and the role picked for it.
  const [roleChoiceFor, setRoleChoiceFor] = useState<string | null>(null);
  const [joinRole, setJoinRole] = useState<RoleId>(DEFAULT_ROLE_ID);
  const [errors, setErrors] = useState<{ joinCode?: string; displayName?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setErrors({});
    setFailure(null);
  }

  async function run(work: () => Promise<void | false>, fallback: string) {
    setBusy(true);
    try {
      // `false` means the step did not finish the form (the role select appeared): give the button back.
      if ((await work()) === false) setBusy(false);
      // Otherwise stay busy on success: the caller replaces this card with the "Request sent" screen.
    } catch (err) {
      setFailure(err instanceof Error && err.message ? err.message : fallback);
      setBusy(false);
    }
  }

  async function submitJoin(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const { code, errors: found } = validateJoin({ joinCode, displayName });
    setErrors(found);
    setFailure(null);
    if (!code || Object.keys(found).length > 0) return;
    await run(async () => {
      if (joinLookup && roleChoiceFor !== code) {
        // The first press asks the server about the code; a team that lets joiners choose shows the role select and waits for the second press.
        const info = await joinLookup(code);
        if (info.alreadyMember) throw new Error(MEMBERSHIP_TEXT.join.alreadyMember);
        if (info.atLimit) throw new Error(MEMBERSHIP_TEXT.join.atLimit);
        if (info.exists && info.allowsRoleChoice) {
          setRoleChoiceFor(code);
          return false;
        }
      }
      await onJoin({ code, name: displayName.trim(), ...(joinLookup && roleChoiceFor === code ? { role: joinRole } : {}) });
    }, "Could not send your request. Check your connection and try again.");
  }

  return (
    <div className="glass-card flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{heading ?? `Set up your ${programLabel ? `${programLabel} ` : ""}team`}</h1>
        {greeting && <p className="text-sm font-medium">{greeting}</p>}
        <p className="text-sm text-[var(--muted-foreground)]">{description ?? `Apply for a team for your ${programLabel ? `${programLabel} ` : ""}scouts, or ask to join one that already exists.`}</p>
      </div>

      {notice && (
        <p role="status" className="glass-card rounded-xl p-3 text-sm" data-testid="join-closed-note">
          {notice}
        </p>
      )}

      <Tabs value={mode} onValueChange={(v) => switchMode(v as Mode)}>
        <TabsList>
          <TabsTrigger value="join">Join a team</TabsTrigger>
          <TabsTrigger value="apply" disabled={applications === "loading"}>
            Apply for a team
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {mode === "join" ? (
        <form onSubmit={submitJoin} className="flex flex-col gap-3" noValidate>
          <div>
            <Label htmlFor="setup-join-code">Team join code</Label>
            <Input id="setup-join-code" autoCapitalize="characters" autoComplete="off" value={joinCode} onChange={(e) => { setJoinCode(e.target.value.toUpperCase()); setRoleChoiceFor(null); }} placeholder="Ask your team admin" aria-invalid={!!errors.joinCode} aria-describedby={errors.joinCode ? "setup-join-code-error" : undefined} />
            <FieldError id="setup-join-code-error" message={errors.joinCode} />
          </div>
          <div>
            <Label htmlFor="setup-display-name">Your name</Label>
            <Input id="setup-display-name" autoComplete="name" maxLength={80} value={displayName} onChange={(e) => setDisplayName(e.target.value)} aria-invalid={!!errors.displayName} aria-describedby={errors.displayName ? "setup-display-name-error" : undefined} />
            <FieldError id="setup-display-name-error" message={errors.displayName} />
          </div>
          {roleChoiceFor && (
            <div data-testid="join-role-choice">
              <Label htmlFor="setup-join-role">{MEMBERSHIP_TEXT.join.roleLabel}</Label>
              <Select value={joinRole} onValueChange={(v) => setJoinRole(v as RoleId)}>
                <SelectTrigger id="setup-join-role" className="h-12">
                  <SelectValue>{getRole(joinRole).label}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ROLES.filter((r) => isRequestableRole(r.id)).map((r) => (
                    <SelectItem key={r.id} value={r.id} className="py-2.5">
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">{MEMBERSHIP_TEXT.join.roleNote}</p>
            </div>
          )}
          {failure && (
            <p role="alert" className="text-sm text-red-400">
              {failure}
            </p>
          )}
          <Button type="submit" className="min-h-11 w-full" disabled={busy}>
            {busy ? (joinLookup && roleChoiceFor === null ? MEMBERSHIP_TEXT.join.checking : "Sending…") : "Send request"}
          </Button>
        </form>
      ) : applications === "closed" ? (
        <p role="status" className="glass-card rounded-xl p-3.5 text-sm text-[var(--muted-foreground)]" data-testid="creation-closed">
          {TEAM_CREATION_CLOSED_TEXT}
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onApply();
          }}
          className="flex flex-col gap-3"
          noValidate
        >
          <p className="glass-card rounded-xl p-3.5 text-sm text-[var(--muted-foreground)]" data-testid="apply-explainer">
            New team accounts are approved by hand, one per team. Next you&apos;ll verify your email and tell us about your team. If your team already has an account, ask your team admin for its join code instead.
          </p>
          <Button type="submit" className="min-h-11 w-full">
            Continue to application
          </Button>
        </form>
      )}
    </div>
  );
}
