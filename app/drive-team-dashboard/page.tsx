import TeamRoleDashboard from "@/app/components/TeamRoleDashboard";

export default function DriveTeamDashboardPage() {
  return (
    <TeamRoleDashboard
      role="drive-team"
      title="Drive Team Dashboard"
      subtitle="Prepare for the next match and document immediate post-match reflections."
      roleDescription="Operates the robot on the field and executes match strategy while communicating in real time with alliance partners and the strategist."
      driveTeamFocus
    />
  );
}
