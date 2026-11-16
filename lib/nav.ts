import type { LucideIcon } from "lucide-react";
import type { FormType } from "@/lib/forms/types";
import {
  LayoutDashboard,
  ClipboardList,
  BarChart3,
  FlaskConical,
  Target,
  Users,
  UsersRound,
  ShieldAlert,
  History,
  Settings,
  SlidersHorizontal,
  Heart,
  CalendarCheck,
  UserCircle,
  CalendarRange,
  ListOrdered,
  UserSearch,
  Route,
  RotateCcw,
  Wrench,
  Lightbulb,
  HandHelping,
  BookOpen,
  Award,
} from "lucide-react";

export type NavItem = {
  /** Stable id the sidebar config refers to (never a label). Equals the page-access id where the page has one. Never rename one. */
  id: string;
  href: string;
  label: string;
  /** Session E: set on the entries that open a form; the navigation shows `formDisplayName(game, formType)` instead of `label` (`useNavLabel`). */
  formType?: FormType;
  icon: LucideIcon;
  matchPrefix?: boolean;
};

export const mainNav: NavItem[] = [
  { id: "event-selection", href: "/event", label: "Active Events", icon: CalendarCheck },
  { id: "assignments", href: "/assignments", label: "Assignments", icon: CalendarRange },
  { id: "dashboard", href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "match-list", href: "/match-list", label: "Match List", icon: ListOrdered },
  { id: "match-scout-form", href: "/scout", formType: "match-scout", label: "Match Scout Form", icon: ClipboardList },
  { id: "lead-scout-form", href: "/lead-scout-form", formType: "lead-scout", label: "Lead Scout Form", icon: UserSearch },
  { id: "match-strategy-form", href: "/match-strategy-form", formType: "match-strategy", label: "Match Strategy Form", icon: Route },
  { id: "drive-reflection-form", href: "/drive-reflection-form", formType: "drive-reflection", label: "Drive Reflection Form", icon: RotateCcw },
  { id: "pit-scout-form", href: "/pit-scout-form", formType: "pit-scout", label: "Pit Scout Form", icon: Wrench },
  { id: "team-strategy-form", href: "/team-strategy-form", formType: "team-strategy", label: "Team Strategy Form", icon: Lightbulb },
  { id: "helper-form", href: "/helper-form", formType: "helper", label: "Helper Form", icon: HandHelping },
  { id: "analytics", href: "/analytics", label: "Analytics", icon: BarChart3, matchPrefix: true },
  { id: "practice-scouting", href: "/practice-scouting", label: "Practice Scouting", icon: FlaskConical },
  { id: "scout-accuracy", href: "/scout-accuracy", label: "Scout Accuracy", icon: Target },
  { id: "my-scouting", href: "/my-scouting", label: "My Scouting", icon: UserCircle },
  { id: "judge-book", href: "/judge-book", label: "Judge Book", icon: BookOpen, matchPrefix: true },
  { id: "people", href: "/people", label: "People", icon: Users },
  { id: "achievements", href: "/achievements", label: "Achievements", icon: Award },
  { id: "team-management", href: "/team-management", label: "Team Management", icon: UsersRound },
];

export const secondaryNav: NavItem[] = [
  { id: "admin-panel", href: "/admin", label: "Admin Panel", icon: ShieldAlert },
  { id: "changelog", href: "/changelog", label: "Changelog", icon: History },
  { id: "credits", href: "/credits", label: "Credits", icon: Heart },
  { id: "team-settings", href: "/team-settings", label: "Team Settings", icon: SlidersHorizontal },
  { id: "account-settings", href: "/account", label: "Account Settings", icon: Settings },
];

/** The Analytics tabs. `group` items sit together under a small label ("Raw data": the entry tables, P30). */
export const analyticsNav: { href: string; label: string; group?: string }[] = [
  { href: "/analytics/match-scout", label: "Match Scout Analytics", group: "Raw data" },
  { href: "/analytics/lead-scout", label: "Lead Scout", group: "Raw data" },
  { href: "/analytics/pit-scout", label: "Pit Scout", group: "Raw data" },
  { href: "/analytics/team-strategy", label: "Team Strategy", group: "Raw data" },
  { href: "/analytics/match-strategy", label: "Match Strategy", group: "Raw data" },
  { href: "/analytics/drive-reflection", label: "Drive Reflection", group: "Raw data" },
  { href: "/analytics/helper", label: "Helper Analytics", group: "Raw data" },
  { href: "/analytics/team-averages", label: "Team Averages" },
  { href: "/analytics/match-breakdown", label: "Match Breakdown" },
  { href: "/analytics/rankings", label: "Rankings" },
  { href: "/analytics/team-breakdown", label: "Team Breakdown" },
  { href: "/analytics/pick-list", label: "Pick List" },
  { href: "/analytics/scout-status", label: "Scout Status" },
  // CS-only analytics (docs/ROUTES.md)
  { href: "/analytics/match-prediction", label: "Match Prediction" },
  { href: "/analytics/performance-reliability", label: "Performance & Reliability" },
  { href: "/analytics/robot-radar", label: "Robot Radar" },
  { href: "/analytics/accuracy-compare", label: "Accuracy Compare" },
  { href: "/analytics/accuracy-verification", label: "Accuracy Verification" },
];

/** Every page the sidebar can show, in the code's default order: the one list the sidebar config arranges (`lib/sidebar`) and the Page Access preview reads. */
export const NAV_PAGES: NavItem[] = [...mainNav, ...secondaryNav];
