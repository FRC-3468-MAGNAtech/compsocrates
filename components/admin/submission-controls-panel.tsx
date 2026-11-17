"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Shimmer } from "@/components/ui/shimmer";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";
import { useForms } from "@/lib/forms/forms-context";
import { MASTER_OFF_MESSAGE, readFormSubmissionSettings, seasonOffMessage, settingsForWrite, withSubmissionChange } from "@/lib/forms/submission-settings";
import { useProgram } from "@/lib/program/context";
import { setFormSubmissionSettings, useTeamDoc } from "@/lib/team";

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Admin Panel > Form Submissions (Session E): the team's switches for NEW form submissions: one master switch ("Allow form submissions") and one per season of the
 * program ("Allow submissions for REEFSCAPE"). Off means Submit is disabled with a message; the form stays open, drafts keep saving, and admins can still edit entries.
 * Stored on the team doc (`formSubmissionSettings`, merge write; the second program writes its own team path). Nothing stored means everything is on.
 * A client-side control, like other team scoping: the rules are not tightened (docs/SECURITY-NOTES.md).
 */
export function SubmissionControlsPanel() {
  const { user, profile } = useAuth();
  const program = useProgram();
  const forms = useForms();
  const teamId = profile?.teamId ?? null;
  const { team, loaded } = useTeamDoc(teamId);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const settings = readFormSubmissionSettings(team?.formSubmissionSettings);
  const seasons = forms.seasons;

  const save = async (key: string, change: { enabled: boolean } | { seasonId: string; open: boolean }) => {
    if (!teamId || !user) return;
    setError(null);
    setSaving(key);
    try {
      const next = withSubmissionChange(settings, change, { uid: user.uid, name: profile?.name ?? "" }, Date.now());
      await setFormSubmissionSettings(teamId, settingsForWrite(next, settings, seasons.map((s) => s.id)), program);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Check your connection and try again.");
    } finally {
      setSaving(null);
    }
  };

  if (!teamId) return <p className="text-sm text-[var(--muted-foreground)]">Join or create a team to set this.</p>;
  if (!loaded) return <Shimmer className="h-48" />;

  return (
    <GlassPanel className="flex flex-col gap-4" data-testid="submission-controls">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--glass-bg-strong)]">
          <Lock className="h-4 w-4" aria-hidden />
        </span>
        <div>
          <h2 className="text-base font-semibold">Form submissions</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            Close new entries for every form, or for one season&apos;s forms (a past season, say). A closed form stays open to read and keeps saving drafts, so scouts never lose what they typed.
            Entries that already exist can still be edited by admins. Everything is on until you turn something off.
          </p>
        </div>
      </div>

      <div className="glass-card flex items-center justify-between gap-4 p-3" data-testid="submissions-master">
        <div>
          <div className="text-sm font-medium" id="submissions-master-label">
            Allow form submissions
          </div>
          <div className="text-xs text-[var(--muted-foreground)]">{settings.enabled ? "Scouts can submit new entries." : `${MASTER_OFF_MESSAGE}. Every form is closed.`}</div>
        </div>
        <Switch aria-labelledby="submissions-master-label" checked={settings.enabled} onCheckedChange={(checked) => void save("master", { enabled: checked })} disabled={saving !== null} />
      </div>

      <div className="flex flex-col gap-2">
        {seasons.map((s) => {
          const open = settings.seasons[s.id] !== false;
          return (
            <div key={s.id} className="glass-card flex items-center justify-between gap-4 p-3" data-testid={`submissions-season-${s.id}`}>
              <div>
                <div className="text-sm font-medium" id={`submissions-season-${s.id}-label`}>
                  Allow submissions for {s.name}
                </div>
                <div className="text-xs text-[var(--muted-foreground)]">
                  {!settings.enabled ? "The master switch is off, so this season is closed too." : open ? `${s.apiSeason} season. Scouts can submit new entries.` : `${seasonOffMessage(s.name)}.`}
                </div>
              </div>
              <Switch aria-labelledby={`submissions-season-${s.id}-label`} checked={open} onCheckedChange={(checked) => void save(s.id, { seasonId: s.id, open: checked })} disabled={saving !== null} />
            </div>
          );
        })}
      </div>

      {saving && <p className="text-xs text-[var(--muted-foreground)]" role="status">Saving…</p>}
      {error && (
        <p className="text-sm text-red-400" role="alert" data-testid="submissions-error">
          Couldn&apos;t save that: {error}
        </p>
      )}
      {settings.updatedAtMs !== undefined && (
        <p className="text-xs text-[var(--muted-foreground)]" data-testid="submissions-updated">
          Last changed {settings.updatedBy?.name ? `by ${settings.updatedBy.name} ` : ""}on {when(settings.updatedAtMs)}.
        </p>
      )}
      <p className="text-xs text-[var(--muted-foreground)]">
        This is a team setting the app enforces for everyone using it. Like other team scoping, the database rules do not enforce it yet.
      </p>
    </GlassPanel>
  );
}
