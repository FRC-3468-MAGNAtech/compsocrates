import TeamRoleDashboard from "@/app/components/TeamRoleDashboard";

export default function JudgeAwardsDashboardPage() {
  return (
    <TeamRoleDashboard
      role="judge-awards"
      title="Judge Awards Dashboard"
      subtitle="Capture judging-ready facts, updates, and visuals in one place."
      roleDescription="Builds and maintains the Judge Book so your team can quickly answer awards questions with accurate, current evidence."
      specialNotice={{
        title: "Judge Book Focus",
        description: "Use Judge Book to add or refine cards before interviews so judges get clear, accurate answers fast.",
        actionLabel: "Open Judge Book",
        actionHref: "/judge-book",
      }}
    />
  );
}

