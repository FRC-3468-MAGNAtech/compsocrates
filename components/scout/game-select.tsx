"use client";

import { Label } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getEnabledSeasons } from "@/lib/seasons";

/**
 * Which game the scout is filling in a form for. The choices come from the game registry (`lib/seasons.ts`, built from `config/games/*`), so a new game
 * appears here with no change; REBUILT is the default. `value` is a season id (`rebuilt`, `reefscape`, `charged_up`).
 */
export function GameSelect({ value, onChange, disabled = false, id = "scout-game" }: { value: string; onChange: (seasonId: string) => void; disabled?: boolean; id?: string }) {
  const games = getEnabledSeasons();
  if (games.length < 2) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Game</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} className="w-48" data-testid="game-select">
          <SelectValue>{games.find((g) => g.id === value)?.name ?? value}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {games.map((g) => (
            <SelectItem key={g.id} value={g.id}>
              {g.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
