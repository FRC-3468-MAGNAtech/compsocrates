"use client";

import { useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { Check, Users } from "lucide-react";
import { OwnershipSection } from "@/components/team/ownership-section";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input, Label } from "@/components/ui/input";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/lib/auth";
import { useOurTeam } from "@/lib/our-team";
import { usePermissions } from "@/lib/permissions";
import { parseTeamNumber } from "@/lib/team-number";

const MAX_TEAM_NAME = 80;

/**
 * The team's name and number (CS's `teamName` / `teamNumber`). Everyone reads them; an admin edits them, which is one merge
 * write of those two fields (firestore.rules lets a team admin write any field of the team doc, so nothing else is touched).
 * Mounted only once the team has loaded, so the draft always starts from the stored values.
 */
function TeamIdentitySection({ teamId, initialName, initialNumber, canEdit }: { teamId: string; initialName: string; initialNumber: string; canEdit: boolean }) {
  const [name, setName] = useState(initialName);
  const [number, setNumber] = useState(initialNumber);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const parsed = parseTeamNumber(number);
  const trimmedName = name.trim();
  const dirty = trimmedName !== initialName.trim() || (parsed !== null && String(parsed) !== initialNumber);
  const numberError = number !== "" && parsed === null ? "Enter a team number with 1 to 5 digits." : null;

  const save = async () => {
    if (parsed === null || trimmedName.length > MAX_TEAM_NAME) return;
    setStatus("saving");
    try {
      // CS stores `teamNumber` as a string. Merge write: every other field of the team doc is left alone.
      await setDoc(doc(db, "teams", teamId), { teamName: trimmedName, teamNumber: String(parsed) }, { merge: true });
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  };

  return (
    <GlassPanel className="flex flex-col gap-4" data-testid="team-identity">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          <Users className="h-4 w-4" /> Team
        </h2>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">{canEdit ? "The name and number your team scouts as." : "The name and number your team scouts as. An admin can change them."}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[10rem_1fr]">
        <div>
          <Label htmlFor="team-number">Team number</Label>
          <Input
            id="team-number"
            inputMode="numeric"
            maxLength={5}
            value={number}
            onChange={(e) => {
              setNumber(e.target.value.replace(/\D/g, ""));
              setStatus("idle");
            }}
            readOnly={!canEdit}
            aria-invalid={numberError ? true : undefined}
          />
          {numberError && <p className="mt-1 text-xs text-red-300">{numberError}</p>}
        </div>
        <div>
          <Label htmlFor="team-name">Team name</Label>
          <Input
            id="team-name"
            value={name}
            maxLength={MAX_TEAM_NAME}
            onChange={(e) => {
              setName(e.target.value);
              setStatus("idle");
            }}
            readOnly={!canEdit}
          />
        </div>
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={save} disabled={!dirty || parsed === null || status === "saving"} className="min-w-28 gap-2">
            {status === "saving" ? "Saving…" : "Save"}
          </Button>
          {status === "saved" && (
            <span role="status" className="flex items-center gap-1.5 text-sm font-medium text-emerald-300">
              <Check className="h-4 w-4" /> Saved
            </span>
          )}
          {status === "error" && (
            <span role="alert" className="text-sm font-medium text-red-300">
              Couldn&apos;t save. You may not have permission.
            </span>
          )}
        </div>
      )}
    </GlassPanel>
  );
}

export default function TeamSettingsPage() {
  const { profile } = useAuth();
  const { isAdmin } = usePermissions();
  const { number, name, loaded } = useOurTeam();
  const teamId = profile?.teamId ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Team Settings</h1>
        <p className="text-sm text-[var(--muted-foreground)]">Your team&apos;s name and number, and who owns the account.</p>
      </div>
      {!loaded || !teamId ? (
        <div className="glass-card h-32 animate-pulse" />
      ) : (
        <TeamIdentitySection teamId={teamId} initialName={name ?? ""} initialNumber={number !== null ? String(number) : ""} canEdit={isAdmin} />
      )}
      <OwnershipSection />
    </div>
  );
}
