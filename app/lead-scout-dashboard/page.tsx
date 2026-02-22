import TeamRoleDashboard from "@/app/components/TeamRoleDashboard";

export default function LeadScoutDashboardPage() {
  return (
    <TeamRoleDashboard
      role="lead-scout"
      title="Lead Scout Dashboard"
      subtitle="Run scout operations, keep data quality high, and coordinate assignments."
      roleDescription="Manages the scouting team, ensures data quality and consistency, and combines objective data with observations to support strategy and alliance decisions."
      showAssignmentsAction
      showManualScoutFallback
    />
  );
}
