import TeamRoleDashboard from "@/app/components/TeamRoleDashboard";

export default function JudgeAwardsDashboardPage() {
  return (
    <TeamRoleDashboard
      role="judge-awards"
      title="Judge Awards Dashboard"
      subtitle="Track assignments and event readiness, then keep awards content polished."
      roleDescription="Uses the same operational dashboard flow as Match Scout, while prioritizing Judge Book quality before interviews."
      specialNotice={{
        title: "Judge Book",
        description: "Open Judge Book to review, update, and present your awards content.",
        actionLabel: "View Judge Book",
        actionHref: "/judge-book",
      }}
    />
  );
}
