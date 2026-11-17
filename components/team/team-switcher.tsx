"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAccountState } from "@/lib/account-state";
import { useMembershipsEnabled } from "@/lib/memberships/client";
import { MEMBERSHIP_TEXT } from "@/lib/memberships/strings";
import { useTeamSwitch } from "@/lib/memberships/switching";
import { useOurTeam } from "@/lib/our-team";
import { useRouter } from "@/lib/program/navigation";
import { teamLabel } from "@/lib/team-number";
import { cn } from "@/lib/utils";

const JOIN_VALUE = "__join__";

/**
 * Which TEAM (not field team) the person is on right now, and the other teams they belong to in this program. One per program: it lists the account's ACTIVE
 * memberships here, switching calls the server (the active team is the user document's pointer, so every permission follows the new team together), and "Join
 * another team" goes to the join screen. Hidden entirely while the memberships kill switch is OFF: nothing is read and nothing is drawn.
 * The field-team switcher (robot teams inside one team) is `FieldTeamSwitcher`, a different thing.
 */
export function TeamSwitcher({ className, compact = false }: { className?: string; compact?: boolean }) {
  const enabled = useMembershipsEnabled();
  if (!enabled) return null;
  return <TeamSwitcherInner className={className} compact={compact} />;
}

function TeamSwitcherInner({ className, compact }: { className?: string; compact: boolean }) {
  // The one-time memberships read happens here, only while the switch is ON.
  const state = useAccountState();
  const { switchTo, error, clearError } = useTeamSwitch();
  const ours = useOurTeam();
  const router = useRouter();
  if (state.status === "loading") return null;

  const active = state.memberships.filter((m) => m.status === "active");
  const activeId = state.activeTeamId;
  const labelOf = (teamId: string, stored?: string): string => {
    if (teamId === activeId && ours.number !== null) return teamLabel(ours.number, ours.name);
    return stored || `Team ${teamId}`;
  };
  const rows = active.map((m) => ({ id: m.teamId, label: labelOf(m.teamId, m.teamLabel) }));
  if (activeId && !rows.some((r) => r.id === activeId)) rows.unshift({ id: activeId, label: labelOf(activeId) });
  if (rows.length === 0) return null;
  const selected = rows.find((r) => r.id === activeId) ?? rows[0];

  return (
    <div className={cn("flex flex-col gap-1", className)} data-testid="membership-team-switcher">
      <Select
        value={selected.id}
        onValueChange={(value) => {
          clearError();
          if (value === JOIN_VALUE) router.push("/apply-to-team");
          else if (value !== selected.id) void switchTo(value);
        }}
      >
        <SelectTrigger aria-label={MEMBERSHIP_TEXT.switcher.label} className={cn("min-h-11 w-full", compact && "max-w-[9.5rem]")}>
          <SelectValue>
            <span className="block truncate">{selected.label}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {rows.map((r) => (
            <SelectItem key={r.id} value={r.id} className="py-2.5">
              {r.label}
            </SelectItem>
          ))}
          <SelectItem value={JOIN_VALUE} className="py-2.5">
            {MEMBERSHIP_TEXT.switcher.joinAnother}
          </SelectItem>
        </SelectContent>
      </Select>
      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
