import TeamRoleDashboard from "@/app/components/TeamRoleDashboard";

export default function LeadStrategistDashboardPage() {
  return (
    <TeamRoleDashboard
      role="lead-strategist"
      title="Lead Strategist Dashboard"
      subtitle="Use scouting analytics to build and adapt event strategy."
      roleDescription="Analyzes scouting data to develop match strategies and works closely with the drive team to adapt plans based on opponents and alliances."
      analyticsGuidance
    />
  );
}
