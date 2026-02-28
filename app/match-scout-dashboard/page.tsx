import TeamRoleDashboard from "@/app/components/TeamRoleDashboard";

export default function MatchScoutDashboardPage() {
  return (
    <TeamRoleDashboard
      role="match-scout"
      title="Match Scout Dashboard"
      subtitle="Track your assignments, submit clean match data, and stay event-ready."
      roleDescription="Collects objective and qualitative match data to support strategy and alliance decisions."
      showManualScoutFallback
    />
  );
}
