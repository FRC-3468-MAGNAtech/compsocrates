import {
  Swords,
  Wrench,
  Gauge,
  ClipboardList,
  Radar,
  Trophy,
  Megaphone,
  Award,
  Timer,
  Battery,
  Users,
  ListChecks,
  TrendingUp,
  BookOpenCheck,
  Camera,
  Star,
  ShieldCheck,
} from "lucide-react";
import GlassCard from "./GlassCard";
import StatTile from "./StatTile";
import PlaceholderTable from "./PlaceholderTable";

export type Role =
  | "match-scout"
  | "pit-scout"
  | "pit-team"
  | "drive-team"
  | "lead-scout"
  | "lead-strategist"
  | "team-coach"
  | "media"
  | "judge-awards";

export const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "match-scout", label: "Match Scout" },
  { value: "pit-scout", label: "Pit Scout" },
  { value: "pit-team", label: "Pit Team" },
  { value: "drive-team", label: "Drive Team" },
  { value: "lead-scout", label: "Lead Scout" },
  { value: "lead-strategist", label: "Lead Strategist" },
  { value: "team-coach", label: "Team Coach" },
  { value: "media", label: "Media" },
  { value: "judge-awards", label: "Judge / Awards" },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--cs-text-dim)]">{children}</h2>
  );
}

export default function RoleDashboard({ role }: { role: Role }) {
  switch (role) {
    case "match-scout":
      return <MatchScoutView />;
    case "pit-scout":
      return <PitScoutView />;
    case "pit-team":
      return <PitTeamView />;
    case "drive-team":
      return <DriveTeamView />;
    case "lead-scout":
      return <LeadScoutView />;
    case "lead-strategist":
      return <LeadStrategistView />;
    case "team-coach":
      return <TeamCoachView />;
    case "media":
      return <MediaView />;
    case "judge-awards":
      return <JudgeAwardsView />;
    default:
      return null;
  }
}

function MatchScoutView() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Next Match" value="Q47" hint="Starts in ~6 min" icon={Timer} accent="volt" />
        <StatTile label="Your Assignment" value="Red 2" icon={Swords} accent="plasma" />
        <StatTile label="Matches Scouted" value="18" hint="This event" icon={ListChecks} accent="current" />
      </div>
      <GlassCard accent="volt">
        <SectionLabel>Up Next</SectionLabel>
        <p className="text-sm text-[var(--cs-text-dim)]">
          Team 4029 · Red 2 — Quick-entry match scout form ready when the match starts.
        </p>
        <div className="mt-4 flex gap-3">
          <span className="rounded-xl bg-[var(--cs-volt)]/15 px-3 py-1.5 text-xs font-semibold text-[var(--cs-volt)]">
            Open Match Scout Form →
          </span>
        </div>
      </GlassCard>
    </div>
  );
}

function PitScoutView() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Pits Visited" value="22 / 40" icon={Wrench} accent="signal" />
        <StatTile label="Drivetrain Types Logged" value="5" icon={Radar} accent="current" />
        <StatTile label="Photos Captured" value="31" icon={Camera} accent="amber" />
      </div>
      <PlaceholderTable columns={["Team", "Drivetrain", "Weight", "Notes"]} rows={4} />
    </div>
  );
}

function PitTeamView() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <StatTile label="Robot Status" value="Ready" icon={ShieldCheck} accent="volt" />
        <StatTile label="Repairs Queued" value="1" icon={Wrench} accent="amber" />
      </div>
      <GlassCard accent="amber">
        <SectionLabel>Checklist</SectionLabel>
        <ul className="space-y-2 text-sm text-[var(--cs-text-dim)]">
          <li>☐ Battery swapped &amp; charged</li>
          <li>☐ Bumpers secured</li>
          <li>☐ Pre-match inspection signed off</li>
        </ul>
      </GlassCard>
    </div>
  );
}

function DriveTeamView() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Battery Voltage" value="12.8V" icon={Battery} accent="volt" />
        <StatTile label="Match Call Time" value="14:02" icon={Timer} accent="current" />
        <StatTile label="Field Position" value="Blue 1" icon={Swords} accent="signal" />
      </div>
      <GlassCard accent="current">
        <SectionLabel>Match Strategy Card</SectionLabel>
        <p className="text-sm text-[var(--cs-text-dim)]">
          Autonomous: 3-piece cycle from position 2. Endgame: climb by T-20s.
        </p>
      </GlassCard>
    </div>
  );
}

function LeadScoutView() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Scouts Active" value="6 / 8" icon={Users} accent="current" />
        <StatTile label="Coverage" value="94%" icon={Gauge} accent="volt" />
        <StatTile label="Data Conflicts" value="2" icon={ClipboardList} accent="plasma" />
      </div>
      <PlaceholderTable columns={["Scout", "Assignment", "Matches Logged", "Accuracy"]} rows={5} />
    </div>
  );
}

function LeadStrategistView() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Alliance Rank" value="#7" icon={Trophy} accent="volt" />
        <StatTile label="Top Pick Candidates" value="5" icon={ListChecks} accent="signal" />
        <StatTile label="Predicted RP" value="+18" icon={TrendingUp} accent="current" />
      </div>
      <GlassCard accent="signal">
        <SectionLabel>Pick List Preview</SectionLabel>
        <p className="text-sm text-[var(--cs-text-dim)]">1. 4029  2. 1618  3. 2056  4. 254  5. 118</p>
      </GlassCard>
    </div>
  );
}

function TeamCoachView() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Team Record" value="9-3-0" icon={Trophy} accent="volt" />
        <StatTile label="Avg Cycle Time" value="6.2s" icon={Timer} accent="current" />
        <StatTile label="Reliability Score" value="A-" icon={ShieldCheck} accent="signal" />
      </div>
      <GlassCard accent="volt">
        <SectionLabel>Drive Reflection Summary</SectionLabel>
        <p className="text-sm text-[var(--cs-text-dim)]">
          "Auto felt consistent, defense in Q41 disrupted our cycle rhythm — adjusting approach angle next match."
        </p>
      </GlassCard>
    </div>
  );
}

function MediaView() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Clips Captured" value="14" icon={Camera} accent="plasma" />
        <StatTile label="Highlight Reels" value="3" icon={Megaphone} accent="signal" />
        <StatTile label="Social Posts Queued" value="7" icon={Star} accent="amber" />
      </div>
      <GlassCard accent="plasma">
        <SectionLabel>Content Queue</SectionLabel>
        <p className="text-sm text-[var(--cs-text-dim)]">Q38 climb clip · Pit tour B-roll · Driver interview</p>
      </GlassCard>
    </div>
  );
}

function JudgeAwardsView() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Award Tracks" value="4" icon={Award} accent="amber" />
        <StatTile label="Judge Notes Logged" value="26" icon={BookOpenCheck} accent="current" />
        <StatTile label="Nominations Drafted" value="2" icon={Star} accent="volt" />
      </div>
      <PlaceholderTable columns={["Team", "Award Track", "Notes", "Status"]} rows={4} />
    </div>
  );
}
