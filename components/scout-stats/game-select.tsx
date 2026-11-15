"use client";

import { Label } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Radix Select cannot hold an empty value, so "every game" is this sentinel; the page state uses "" for it. */
const ALL_GAMES = "all";

type GameOption = { id: string; name: string };

/**
 * The Game select shared by Scout Accuracy and My Scouting. `value` is a season id, or "" for every game. A program with one game
 * shows it disabled (nothing to choose).
 */
export function GameSelect({ value, onChange, seasons, id = "scout-stats-game", allowAll = true }: { value: string; onChange: (seasonId: string) => void; seasons: readonly GameOption[]; id?: string; allowAll?: boolean }) {
  const single = seasons.length <= 1;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Game</Label>
      <Select value={value || ALL_GAMES} onValueChange={(v) => onChange(v === ALL_GAMES ? "" : v)} disabled={single}>
        <SelectTrigger id={id} className="w-48" data-testid="game-select">
          <SelectValue>{value ? (seasons.find((s) => s.id === value)?.name ?? value) : "All games"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {allowAll && !single && <SelectItem value={ALL_GAMES}>All games</SelectItem>}
          {seasons.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
