"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useProgramConfig } from "@/lib/program/context";
import { useProgramData } from "@/lib/program/data";
import { parseJoinCode, validateNewTeam, LOCATION_MAX, NAME_MAX, type SetupFormErrors } from "@/lib/team-setup";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Mode = "create" | "join";

const isDenied = (err: unknown) => (err as { code?: string } | null)?.code === "permission-denied";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs text-red-400">
      {message}
    </p>
  );
}

/**
 * Setup screen for a signed-in person with no profile in a program that has an enrollment port (ProgramData.enrollment): start a team
 * (becoming its admin) or ask to join one with a join code. When the profile is written, the shell's own subscription picks it up and
 * replaces this screen, so nothing here navigates.
 */
export function TeamSetup() {
  const config = useProgramConfig();
  const data = useProgramData();
  const { user } = useAuth();
  const [mode, setMode] = useState<Mode>("create");

  const [teamNumber, setTeamNumber] = useState("");
  const [teamName, setTeamName] = useState("");
  const [location, setLocation] = useState("");
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [joinCode, setJoinCode] = useState("");
  const [errors, setErrors] = useState<SetupFormErrors & { joinCode?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (!data || !user) return null;
  const { enrollment } = data;
  const label = config.brand.label;

  function switchMode(next: Mode) {
    setMode(next);
    setErrors({});
    setFailure(null);
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !user) return;
    const { number, errors: found } = validateNewTeam({ teamNumber, teamName, location, displayName });
    setErrors(found);
    setFailure(null);
    if (number === null || Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      await enrollment.createTeam({ uid: user.uid, email: user.email ?? "", name: displayName, teamNumber: number, teamName, location });
      // Stay busy: the shell replaces this screen as soon as the new profile arrives.
    } catch (err) {
      setFailure(isDenied(err) ? "Your account already has a team here, or the team could not be created. Reload the page and try again." : "Could not create your team. Check your connection and try again.");
      setBusy(false);
    }
  }

  async function submitJoin(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !user) return;
    const code = parseJoinCode(joinCode);
    const found: typeof errors = {};
    if (!code) found.joinCode = "Enter the join code your team admin gave you.";
    if (!displayName.trim()) found.displayName = "Enter your name.";
    else if (displayName.trim().length > NAME_MAX) found.displayName = `Keep your name under ${NAME_MAX} characters.`;
    setErrors(found);
    setFailure(null);
    if (!code || Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      await enrollment.requestToJoin(code, { uid: user.uid, name: displayName });
      setSentTo(code);
    } catch (err) {
      setFailure(isDenied(err) ? "That code did not match a team, or you have already sent a request to it." : "Could not send your request. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const nameField = (
    <div>
      <Label htmlFor="setup-display-name">Your name</Label>
      <Input id="setup-display-name" autoComplete="name" maxLength={NAME_MAX} value={displayName} onChange={(e) => setDisplayName(e.target.value)} aria-invalid={!!errors.displayName} aria-describedby={errors.displayName ? "setup-display-name-error" : undefined} />
      <FieldError id="setup-display-name-error" message={errors.displayName} />
    </div>
  );

  return (
    <div className="glass-card flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Set up your {label} team</h1>
        <p className="text-sm text-[var(--muted-foreground)]">Start a team for your {label} scouts, or ask to join one that already exists.</p>
      </div>

      <Tabs value={mode} onValueChange={(v) => switchMode(v as Mode)}>
        <TabsList>
          <TabsTrigger value="create">Create a team</TabsTrigger>
          <TabsTrigger value="join">Join a team</TabsTrigger>
        </TabsList>
      </Tabs>

      {mode === "create" ? (
        <form onSubmit={submitCreate} className="flex flex-col gap-3" noValidate>
          <div>
            <Label htmlFor="setup-team-number">Team number</Label>
            <Input id="setup-team-number" inputMode="numeric" autoComplete="off" maxLength={5} value={teamNumber} onChange={(e) => setTeamNumber(e.target.value)} placeholder="12345" aria-invalid={!!errors.teamNumber} aria-describedby={errors.teamNumber ? "setup-team-number-error" : undefined} />
            <FieldError id="setup-team-number-error" message={errors.teamNumber} />
          </div>
          <div>
            <Label htmlFor="setup-team-name">Team name</Label>
            <Input id="setup-team-name" maxLength={NAME_MAX} value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Team name" aria-invalid={!!errors.teamName} aria-describedby={errors.teamName ? "setup-team-name-error" : undefined} />
            <FieldError id="setup-team-name-error" message={errors.teamName} />
          </div>
          <div>
            <Label htmlFor="setup-location">Location (optional)</Label>
            <Input id="setup-location" maxLength={LOCATION_MAX} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="City, state or country" aria-invalid={!!errors.location} aria-describedby={errors.location ? "setup-location-error" : undefined} />
            <FieldError id="setup-location-error" message={errors.location} />
          </div>
          {nameField}
          <p className="text-xs text-[var(--muted-foreground)]">You become the team admin. Your team gets a join code to share with your scouts.</p>
          {failure && (
            <p role="alert" className="text-sm text-red-400">
              {failure}
            </p>
          )}
          <Button type="submit" className="min-h-11 w-full" disabled={busy}>
            {busy ? "Creating your team…" : "Create team"}
          </Button>
        </form>
      ) : sentTo ? (
        <div className="flex flex-col gap-2" role="status">
          <p className="text-sm">Request sent for code {sentTo}. A team admin has to approve it.</p>
          <Button variant="glass" className="min-h-11 w-full" onClick={() => setSentTo(null)}>
            Send another request
          </Button>
        </div>
      ) : (
        <form onSubmit={submitJoin} className="flex flex-col gap-3" noValidate>
          <div>
            <Label htmlFor="setup-join-code">Team join code</Label>
            <Input id="setup-join-code" autoCapitalize="characters" autoComplete="off" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="Ask your team admin" aria-invalid={!!errors.joinCode} aria-describedby={errors.joinCode ? "setup-join-code-error" : undefined} />
            <FieldError id="setup-join-code-error" message={errors.joinCode} />
          </div>
          {nameField}
          {failure && (
            <p role="alert" className="text-sm text-red-400">
              {failure}
            </p>
          )}
          <Button type="submit" className="min-h-11 w-full" disabled={busy}>
            {busy ? "Sending…" : "Send request"}
          </Button>
        </form>
      )}

      <p className="text-xs text-[var(--muted-foreground)]">
        Accounts moved from the previous {label} site appear here once the data import has run.
      </p>
    </div>
  );
}
