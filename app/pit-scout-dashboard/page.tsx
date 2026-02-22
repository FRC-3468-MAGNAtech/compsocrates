import TeamRoleDashboard from "@/app/components/TeamRoleDashboard";

export default function PitScoutDashboardPage() {
  return (
    <TeamRoleDashboard
      role="pit-scout"
      title="Pit Scout Dashboard"
      subtitle="Build technical intel on robots before and during events."
      roleDescription="Collects technical and qualitative information about robots to support match strategy and alliance selection."
      pitScoutFocus
    />
  );
}
