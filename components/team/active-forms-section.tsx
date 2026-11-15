"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { useFormDisplayNames } from "@/lib/forms/use-form-display-name";
import { useForms } from "@/lib/forms/forms-context";
import { canBeActive } from "@/lib/forms/resolve";
import { usePermissions } from "@/lib/permissions";
import { useProgramData } from "@/lib/program/data";
import { useTeamDoc } from "@/lib/team";

const SAVE_FAILED = "Couldn't save the form. You may not have permission, or the connection dropped. Nothing was changed.";

/** One season's row: the match form scouts fill in for it. */
function SeasonRow({ seasonId, canEdit, teamId }: { seasonId: string; canEdit: boolean; teamId: string }) {
  const { user, profile } = useAuth();
  const port = useProgramData();
  const forms = useForms();
  const names = useFormDisplayNames(seasonId);
  const season = forms.seasonFor(seasonId);
  const activeId = forms.activeFormIdFor(seasonId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The season's own built-in, plus any saved match form the account can use that is tagged for this season. A form that cannot be active (archived, unpublished) is not offered.
  const options = forms.summaries
    .filter((s) => canBeActive(forms.catalog, s.id))
    .map((s) => ({ id: s.id, form: forms.latest(s.id) }))
    .filter((o) => o.form !== null && (o.id === season.formId || o.id === activeId || (o.form.tags ?? []).some((tag) => tag.toLowerCase().replace(/-/g, "_") === season.id)))
    .map((o) => ({ id: o.id, label: names.forForm(o.form!) + (o.id === season.formId ? " (default)" : "") }));
  const current = options.find((o) => o.id === activeId);

  const choose = async (formId: string) => {
    if (!port || !user || !profile || formId === activeId) return;
    setBusy(true);
    setError(null);
    try {
      await port.team.setActiveForm({ teamId, uid: user.uid, name: profile.name }, season.id, formId, forms.activeForms[season.id] ?? null);
    } catch {
      setError(SAVE_FAILED);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`active-form-${season.id}`} className="text-sm font-medium">
        {season.name}
      </label>
      <Select value={activeId} onValueChange={choose} disabled={!canEdit || busy || options.length < 2}>
        <SelectTrigger id={`active-form-${season.id}`}>
          <SelectValue>{current?.label ?? names.forType("match-scout")}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {options.length < 2 && <p className="text-xs text-[var(--muted-foreground)]">Only the built-in form exists for this season, so there is nothing to choose yet.</p>}
      {error && (
        <p role="alert" className="text-sm font-medium text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Team Settings > Form for each season (a program whose Admin Panel has no Forms tab, `ProgramConfig.teamSettings.activeForms`): which match scouting form
 * scouts fill in for each season (`teams.activeForms.{season}`). Nothing stored means the season's built-in form, so nothing changes by default. This is NOT
 * the submission switch: whether new submissions are open at all is Admin Panel > Submissions (`formSubmissionSettings`), which is separate and untouched.
 */
export function ActiveFormsSection() {
  const { profile } = useAuth();
  const { isAdmin, isOwner } = usePermissions();
  const teamId = profile?.teamId ?? null;
  const { loaded } = useTeamDoc(teamId);
  const forms = useForms();
  if (!teamId || !loaded || !forms.loaded) return <div className="glass-card h-24 animate-pulse" />;
  return (
    <GlassPanel className="flex flex-col gap-4" data-testid="active-forms">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          <FileText className="h-4 w-4" /> Form for each season
        </h2>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          The match scouting form your scouts fill in for each season. Whether new submissions are open at all is set in the Admin Panel, under Submissions.
        </p>
      </div>
      {forms.seasons.map((s) => (
        <SeasonRow key={s.id} seasonId={s.id} canEdit={isAdmin || isOwner} teamId={teamId} />
      ))}
    </GlassPanel>
  );
}
