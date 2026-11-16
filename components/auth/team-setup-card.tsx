"use client";

import { useState, type ReactNode } from "react";
import { DEFAULT_ROLE_ID, getRole, ROLES, type RoleId } from "@/lib/roles";
import { TEAM_CREATION_CLOSED_TEXT, validateCreate, validateJoin } from "@/lib/team-setup";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Mode = "join" | "create";

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
  /**
   * "open": anyone may create a team. "apply": creating needs an application (the Create tab becomes "Apply to create a team" and goes on to it).
   * "closed": creating is switched off and there is no application to go on to (the Create tab shows a notice, nothing else). "loading": not known yet
   * (the Create tab waits). `creationMode` (lib/team-setup.ts) picks one from `appSettings/global.teamCreationEnabled`.
   */
  creation: "open" | "apply" | "closed" | "loading";
  /** The name sent with a join request or a new team: the account's own name (shown in, and editable on, the join form). */
  defaultName: string;
  /** A line above the form (for example, why the last request was closed). */
  notice?: string | null;
  /** Sends a join request. Throw an Error with the words to show if it fails. Resolve once it is sent; the caller then replaces the card. */
  onJoin: (input: { code: string; name: string }) => Promise<void>;
  /** Creates the team. Throw an Error with the words to show if it fails. Resolve once it is created; the caller then replaces the card. */
  onCreate: (input: { teamNumber: number; teamName: string; role: RoleId; name: string }) => Promise<void>;
  /** "apply" creation only: the person asked to go on to the application. */
  onApply: () => void;
  /** Extra small print at the bottom (program-specific). */
  footnote?: ReactNode;
};

/**
 * THE team setup screen, for every program: Join a team first, Create a team second, one card. The Join form is a join code and your name; the
 * Create form is a team number, an optional team name and your role. Each program supplies only what happens on submit (`onJoin`, `onCreate`), so
 * the two screens cannot drift apart. Created teams ask for no location here.
 */
export function TeamSetupCard({ programLabel, greeting, creation, defaultName, notice, onJoin, onCreate, onApply, footnote }: TeamSetupCardProps) {
  const [mode, setMode] = useState<Mode>("join");
  const [joinCode, setJoinCode] = useState("");
  const [displayName, setDisplayName] = useState(defaultName);
  const [teamNumber, setTeamNumber] = useState("");
  const [teamName, setTeamName] = useState("");
  const [role, setRole] = useState<RoleId>(DEFAULT_ROLE_ID);
  const [errors, setErrors] = useState<{ joinCode?: string; displayName?: string; teamNumber?: string; teamName?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const applying = creation === "apply";

  function switchMode(next: Mode) {
    setMode(next);
    setErrors({});
    setFailure(null);
  }

  async function run(work: () => Promise<void>, fallback: string) {
    setBusy(true);
    try {
      await work();
      // Stay busy on success: the caller replaces this card (a pending-request view, the join code, or the shell once the profile arrives).
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
    await run(() => onJoin({ code, name: displayName.trim() }), "Could not send your request. Check your connection and try again.");
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setFailure(null);
    if (applying) {
      onApply();
      return;
    }
    const { number, teamName: name, errors: found } = validateCreate({ teamNumber, teamName });
    setErrors(found);
    if (number === null || Object.keys(found).length > 0) return;
    await run(() => onCreate({ teamNumber: number, teamName: name, role, name: displayName.trim() || defaultName.trim() }), "Could not create your team. Check your connection and try again.");
  }

  return (
    <div className="glass-card flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Set up your {programLabel ? `${programLabel} ` : ""}team</h1>
        {greeting && <p className="text-sm font-medium">{greeting}</p>}
        <p className="text-sm text-[var(--muted-foreground)]">Start a team for your {programLabel ? `${programLabel} ` : ""}scouts, or ask to join one that already exists.</p>
      </div>

      {notice && (
        <p role="status" className="glass-card rounded-xl p-3 text-sm" data-testid="join-closed-note">
          {notice}
        </p>
      )}

      <Tabs value={mode} onValueChange={(v) => switchMode(v as Mode)}>
        <TabsList>
          <TabsTrigger value="join">Join a team</TabsTrigger>
          <TabsTrigger value="create" disabled={creation === "loading"}>
            {applying ? "Apply to create a team" : "Create a team"}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {mode === "join" ? (
        <form onSubmit={submitJoin} className="flex flex-col gap-3" noValidate>
          <div>
            <Label htmlFor="setup-join-code">Team join code</Label>
            <Input id="setup-join-code" autoCapitalize="characters" autoComplete="off" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="Ask your team admin" aria-invalid={!!errors.joinCode} aria-describedby={errors.joinCode ? "setup-join-code-error" : undefined} />
            <FieldError id="setup-join-code-error" message={errors.joinCode} />
          </div>
          <div>
            <Label htmlFor="setup-display-name">Your name</Label>
            <Input id="setup-display-name" autoComplete="name" maxLength={80} value={displayName} onChange={(e) => setDisplayName(e.target.value)} aria-invalid={!!errors.displayName} aria-describedby={errors.displayName ? "setup-display-name-error" : undefined} />
            <FieldError id="setup-display-name-error" message={errors.displayName} />
          </div>
          {failure && (
            <p role="alert" className="text-sm text-red-400">
              {failure}
            </p>
          )}
          <Button type="submit" className="min-h-11 w-full" disabled={busy}>
            {busy ? "Sending…" : "Send request"}
          </Button>
        </form>
      ) : creation === "closed" ? (
        <p role="status" className="glass-card rounded-xl p-3.5 text-sm text-[var(--muted-foreground)]" data-testid="creation-closed">
          {TEAM_CREATION_CLOSED_TEXT}
        </p>
      ) : applying ? (
        <form onSubmit={submitCreate} className="flex flex-col gap-3" noValidate>
          <p className="glass-card rounded-xl p-3.5 text-sm text-[var(--muted-foreground)]" data-testid="apply-explainer">
            New team accounts are approved by hand, one per team. Next you&apos;ll verify your email and tell us about your team. If your team already has an account, ask your team admin for its join code instead.
          </p>
          <Button type="submit" className="min-h-11 w-full">
            Continue to application
          </Button>
        </form>
      ) : (
        <form onSubmit={submitCreate} className="flex flex-col gap-3" noValidate>
          <div>
            <Label htmlFor="setup-team-number">Team number</Label>
            <Input id="setup-team-number" inputMode="numeric" autoComplete="off" maxLength={5} value={teamNumber} onChange={(e) => setTeamNumber(e.target.value)} placeholder="12345" aria-invalid={!!errors.teamNumber} aria-describedby={errors.teamNumber ? "setup-team-number-error" : undefined} />
            <FieldError id="setup-team-number-error" message={errors.teamNumber} />
          </div>
          <div>
            <Label htmlFor="setup-team-name">Team name (optional)</Label>
            <Input id="setup-team-name" maxLength={80} value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Team name" aria-invalid={!!errors.teamName} aria-describedby={errors.teamName ? "setup-team-name-error" : undefined} />
            <FieldError id="setup-team-name-error" message={errors.teamName} />
          </div>
          <div>
            <Label htmlFor="setup-role">Your role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as RoleId)}>
              <SelectTrigger id="setup-role" className="h-12">
                <SelectValue>{getRole(role).label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r.id} value={r.id} className="py-2.5">
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {failure && (
            <p role="alert" className="text-sm text-red-400">
              {failure}
            </p>
          )}
          <Button type="submit" className="min-h-11 w-full" disabled={busy}>
            {busy ? "Creating your team…" : "Create team"}
          </Button>
        </form>
      )}

      {footnote && <p className="text-xs text-[var(--muted-foreground)]">{footnote}</p>}
    </div>
  );
}
