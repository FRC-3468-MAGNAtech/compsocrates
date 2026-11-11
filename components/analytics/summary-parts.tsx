"use client";

import { useState } from "react";
import Link from "next/link";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { OurTeamTag } from "@/components/analytics/team-bits";
import { useAnalyticsHref } from "@/lib/analytics/filter-context";
import { useIsOurTeam } from "@/lib/field-teams-context";
import type { ImageValue } from "@/lib/forms/types";

// Small pieces both summary views share (the BIOBUZZ one in form-summaries-view.tsx, the REBUILT one in form-summaries-rebuilt-view.tsx), kept apart so neither view
// imports the other.

/** A team number as a chip that links to the Team Profile (with the "us" tag for our own teams). */
export function TeamChip({ team, names }: { team: number; names: ReadonlyMap<number, string> }) {
  const ours = useIsOurTeam()(team);
  const href = useAnalyticsHref();
  return (
    <Link href={href(`/analytics/teams/${team}`)} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--glass-border)] px-2.5 py-1 text-xs font-semibold tabular-nums hover:bg-white/10" title={names.get(team)}>
      {team}
      {ours && <OurTeamTag />}
    </Link>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <GlassPanel className="py-10 text-center text-sm text-[var(--muted-foreground)]">{children}</GlassPanel>;
}

/** "Showing the latest entry per team. See all" toggle line. */
export function LatestToggle({ showAll, onChange, what }: { showAll: boolean; onChange: (v: boolean) => void; what: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted-foreground)]">
      <span>{showAll ? `Showing every entry for each ${what}.` : `Showing the latest entry for each ${what}.`}</span>
      <Button type="button" variant="glass" size="sm" onClick={() => onChange(!showAll)} data-testid="see-all-toggle">
        {showAll ? "Latest only" : "See all entries"}
      </Button>
    </div>
  );
}

/** A 1-5 skill as a number with a thin bar; a dash when there is none. */
export function Skill({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[var(--muted-foreground)]">—</span>;
  return (
    <span className="inline-flex items-center gap-2 tabular-nums">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10" aria-hidden>
        <span className="block h-full rounded-full" style={{ width: `${(value / 5) * 100}%`, background: "var(--theme-gradient)" }} />
      </span>
      {value.toFixed(1)}
    </span>
  );
}

export function Fact({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</div>
      <div className="tabular-nums">{value === null || value === "" ? "—" : value}</div>
    </div>
  );
}

export function Lightbox({ photos, start, onClose, title }: { photos: ImageValue[]; start: number; onClose: () => void; title: string }) {
  const [i, setI] = useState(start);
  const photo = photos[i];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(94vw,900px)]" data-testid="lightbox">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          Photo {i + 1} of {photos.length}
        </DialogDescription>
        {photo && (
          <div className="mt-2 flex max-h-[70vh] items-center justify-center overflow-hidden rounded-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element -- a Vercel Blob URL on a host we don't configure for next/image */}
            <img src={photo.url} alt={`${title}: photo ${i + 1}`} className="max-h-[70vh] w-auto max-w-full object-contain" />
          </div>
        )}
        {photos.length > 1 && (
          <div className="mt-3 flex justify-between gap-2">
            <Button variant="glass" size="sm" onClick={() => setI((i + photos.length - 1) % photos.length)}>
              Previous
            </Button>
            <Button variant="glass" size="sm" onClick={() => setI((i + 1) % photos.length)}>
              Next
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
