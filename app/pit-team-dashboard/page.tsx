import TeamRoleDashboard from "@/app/components/TeamRoleDashboard";

export default function PitTeamDashboardPage() {
  return (
    <TeamRoleDashboard
      role="pit-team"
      title="Pit Team Dashboard"
      subtitle="Manage robot readiness and support requests in the pit."
      roleDescription="Works in the pit to repair, maintain, and improve the robot between matches while communicating robot status to the drive team and strategists."
      pitTeamFocus
    />
  );
}
