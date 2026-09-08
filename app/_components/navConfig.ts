import {
  LayoutDashboard,
  ClipboardList,
  Swords,
  Users,
  ShieldCheck,
  UserCircle,
  Gauge,
  BarChart3,
  Radar,
  ListOrdered,
  Trophy,
  Wrench,
  BookOpenCheck,
  CalendarClock,
  ListChecks,
  UserCog,
  Users2,
  ShieldAlert,
  History,
  Settings,
  LucideIcon,
} from "lucide-react";

export type NavLeaf = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export type NavGroup = {
  label: string;
  icon: LucideIcon;
  items: NavLeaf[];
  children?: NavGroup[];
};

export const navGroups: NavGroup[] = [
  {
    label: "Dashboard",
    icon: LayoutDashboard,
    items: [{ label: "Overview", href: "/dashboard", icon: Gauge }],
  },
  {
    label: "Forms",
    icon: ClipboardList,
    items: [
      { label: "Match Scout", href: "/forms/match-scout", icon: Swords },
      { label: "Lead Scout", href: "/forms/lead-scout", icon: ClipboardList },
      { label: "Team Strategy", href: "/forms/team-strategy", icon: Wrench },
      { label: "Match Strategy", href: "/forms/match-strategy", icon: Swords },
      { label: "Drive Reflection", href: "/forms/drive-reflection", icon: BookOpenCheck },
      { label: "Helper", href: "/forms/helper", icon: ListChecks },
    ],
  },
  {
    label: "Analytics",
    icon: BarChart3,
    items: [{ label: "Overview", href: "/analytics", icon: BarChart3 }],
    children: [
      {
        label: "Raw Data",
        icon: ListOrdered,
        items: [
          { label: "Match", href: "/analytics/match", icon: Swords },
          { label: "Lead", href: "/analytics/lead", icon: ClipboardList },
          { label: "Pit", href: "/analytics/pit", icon: Wrench },
          { label: "Team Strategy", href: "/analytics/team-strategy", icon: Wrench },
          { label: "Match Strategy", href: "/analytics/match-strategy", icon: Swords },
          { label: "Drive Reflection", href: "/analytics/drive-reflection", icon: BookOpenCheck },
          { label: "Helper Reports", href: "/analytics/helper-reports", icon: ListChecks },
        ],
      },
      {
        label: "Organized Data",
        icon: Radar,
        items: [
          { label: "Team Averages", href: "/analytics/team-averages", icon: BarChart3 },
          { label: "Match Breakdown", href: "/analytics/match-breakdown", icon: ListOrdered },
          { label: "Rankings", href: "/analytics/rankings", icon: Trophy },
          { label: "Team Breakdown", href: "/analytics/team-breakdown", icon: BarChart3 },
          { label: "Performance Reliability", href: "/analytics/performance-reliability", icon: ShieldCheck },
          { label: "Robot Radar", href: "/analytics/robot-radar", icon: Radar },
          { label: "Pick List", href: "/analytics/pick-list", icon: ListChecks },
          { label: "Scout Status", href: "/analytics/scout-status", icon: UserCog },
        ],
      },
    ],
  },
  {
    label: "Scouting Tools",
    icon: Radar,
    items: [
      { label: "Practice Scouting", href: "/practice-scouting", icon: ClipboardList },
      { label: "Scout Accuracy", href: "/scout-accuracy", icon: Gauge },
      { label: "Judge Book", href: "/judge-book", icon: BookOpenCheck },
      { label: "Event Selection", href: "/event-selection", icon: CalendarClock },
      { label: "Match List", href: "/match-list", icon: ListOrdered },
    ],
  },
  {
    label: "Management",
    icon: Users2,
    items: [
      { label: "Assignments", href: "/assignments", icon: ListChecks },
      { label: "People", href: "/people", icon: Users },
      { label: "Team Management", href: "/team-management", icon: Users2 },
      { label: "Admin", href: "/admin", icon: ShieldAlert },
      { label: "Changelog", href: "/changelog", icon: History },
    ],
  },
  {
    label: "Account",
    icon: UserCircle,
    items: [
      { label: "Account", href: "/account", icon: Settings },
      { label: "Profile", href: "/profile", icon: UserCircle },
    ],
  },
];
