// Where a signed-in account may be, with and without a team. Pure (no React, no Firebase): the signed-in shell (`app/(app)/[program]/layout.tsx`) asks
// `resolveShellRoute` and does what it says, so the routing can be tested exhaustively and cannot loop.
//
// Memberships build 3: with `appSettings/global.membershipsEnabled` ON, an account with NO team is not sent away to a setup screen: it lives in a limited "personal"
// shell (its dashboard, Practice Scouting, its profile, Achievements, Account Settings, Credits, the Changelog, and the Join / Apply screen) and every other path
// goes to its dashboard. With the switch OFF nothing is different from before: no team means the setup screen at `/apply-to-team` and nothing else.

/** The program-relative pages an account with no team may open (a path matches itself and anything under it). */
export const PERSONAL_PATHS = ["/dashboard", "/practice-scouting", "/profile", "/achievements", "/account", "/credits", "/changelog", "/apply-to-team"] as const;

/** Extra pages that only the platform owner may open without a team (the Admin Panel: applications are approved there, in a program the owner may have no team in). */
export const PERSONAL_PLATFORM_OWNER_PATHS = ["/admin"] as const;

/** The sidebar ids (lib/nav.ts) of the personal pages, in display order, and the one only the platform owner adds. */
export const PERSONAL_PAGE_IDS = ["dashboard", "practice-scouting", "achievements", "changelog", "credits", "account-settings"] as const;
export const PERSONAL_PLATFORM_OWNER_PAGE_IDS = ["admin-panel"] as const;

/** The route the shell sends an account with no team to: the one place every account may always be. */
export const SETUP_PATH = "/apply-to-team";
export const PERSONAL_HOME = "/dashboard";

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

export function isPersonalPath(pathname: string, isPlatformOwner: boolean): boolean {
  const path = pathname.split(/[?#]/)[0] || "/";
  // The setup route is one page (no sub-paths); every other personal page also owns what is under it.
  return PERSONAL_PATHS.some((p) => (p === SETUP_PATH ? path === p : under(path, p))) || (isPlatformOwner && PERSONAL_PLATFORM_OWNER_PATHS.some((p) => under(path, p)));
}

export type ShellRoute = {
  /** What the shell draws: a spinner, the stand-alone setup screen (switch OFF, no team), the limited personal shell, or the full team shell. */
  render: "loading" | "setup" | "personal" | "team";
  /** A route to replace the current one with, or null. */
  redirect: string | null;
};

export type ShellInput = {
  /** The auth state has loaded. */
  loaded: boolean;
  signedIn: boolean;
  /** The active program's profile has a non-empty team id. */
  hasTeam: boolean;
  /** `membershipsEnabled` ON. */
  memberships: boolean;
  /** The switch's answer has arrived (until it has, a person with no team waits on the spinner instead of being routed by a guess). */
  membershipsKnown: boolean;
  /** Program-relative path, no query. */
  pathname: string;
  isPlatformOwner: boolean;
};

const WAIT: ShellRoute = { render: "loading", redirect: null };
const go = (to: string): ShellRoute => ({ render: "loading", redirect: to });

export function resolveShellRoute(input: ShellInput): ShellRoute {
  if (!input.loaded) return WAIT;
  if (!input.signedIn) return go("/login");
  const onSetup = (input.pathname.split(/[?#]/)[0] || "/") === SETUP_PATH;

  if (input.hasTeam) {
    // A person with a team opens the join screen again only with memberships ON ("Join another team"); OFF, that route moves them on to the dashboard.
    if (onSetup && !input.memberships) return go(PERSONAL_HOME);
    return { render: "team", redirect: null };
  }

  if (!input.membershipsKnown) return WAIT;
  if (!input.memberships) return onSetup ? { render: "setup", redirect: null } : go(SETUP_PATH);
  // ON, no team: the personal shell for its own pages, the dashboard for every other path. The dashboard and the setup route are personal pages, so this never loops.
  return isPersonalPath(input.pathname, input.isPlatformOwner) ? { render: "personal", redirect: null } : go(PERSONAL_HOME);
}
