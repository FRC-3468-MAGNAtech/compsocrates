"use client";

import { Label } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForms } from "@/lib/forms/forms-context";

/**
 * Which game the scout is filling in a form for. The choices are the active program's games (the forms context: `lib/seasons.ts` built from
 * `config/games/*` for the default program, the program's own registry otherwise), so a new game appears here with no change. `seasons` narrows the
 * list (a form that exists for one game only offers that one). With one game the select is still shown, disabled, so every form page looks alike.
 * `value` is a season id (`rebuilt`, `reefscape`, `charged_up`).
 */
export function GameSelect({ value, onChange, disabled = false, id = "scout-game", seasons }: { value: string; onChange: (seasonId: string) => void; disabled?: boolean; id?: string; seasons?: readonly { id: string; name: string }[] }) {
  const all = useForms().seasons;
  const games = seasons ?? all;
  if (games.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Game</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled || games.length < 2}>
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
