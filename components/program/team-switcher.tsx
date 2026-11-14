"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAccountTeamChoice } from "@/lib/our-team";
import { useProgramConfig } from "@/lib/program/context";
import { teamLabel } from "@/lib/team-number";
import { cn } from "@/lib/utils";

/**
 * Which of the account's teams the person is viewing as (`lib/our-team.ts`). Shown only in a program that allows several teams per account
 * (`ProgramConfig.multiTeam`) and only when the person can pick between at least two; everywhere else it renders nothing.
 */
export function TeamSwitcher({ className }: { className?: string }) {
  const { multiTeam } = useProgramConfig();
  const { teams, selectedId, select } = useAccountTeamChoice();
  if (!multiTeam || teams.length < 2) return null;
  const selected = teams.find((t) => t.id === selectedId) ?? teams[0];
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Select value={selected.id} onValueChange={select}>
        <SelectTrigger aria-label="Team" className="w-full" data-testid="team-switcher">
          <SelectValue>{teamLabel(selected.number, selected.name)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {teams.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {teamLabel(t.number, t.name)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
