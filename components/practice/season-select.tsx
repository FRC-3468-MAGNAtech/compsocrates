"use client";

import { GlassPanel } from "@/components/ui/glass-panel";
import { useForms } from "@/lib/forms/forms-context";

/** One card per game the active program scouts (one card for a program with a single game). The same screen in every program. */
export function SeasonSelect({ onSelect }: { onSelect: (seasonId: string) => void }) {
  const seasons = useForms().seasons;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-bold">Choose a season</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {seasons.map((season) => (
          <GlassPanel
            key={season.id}
            interactive
            onClick={() => onSelect(season.id)}
            className="flex flex-col items-center gap-2 py-10 text-center"
          >
            <span className="text-2xl font-bold">{season.name}</span>
          </GlassPanel>
        ))}
      </div>
    </div>
  );
}
