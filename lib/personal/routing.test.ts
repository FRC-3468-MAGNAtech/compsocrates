import { describe, expect, it } from "vitest";
import { isPersonalPath, PERSONAL_PAGE_IDS, PERSONAL_PATHS, PERSONAL_PLATFORM_OWNER_PATHS, resolveShellRoute, SETUP_PATH, type ShellInput } from "@/lib/personal/routing";
import { APP_SEGMENTS } from "@/config/legacy-redirects";
import { NAV_PAGES } from "@/lib/nav";

const base: ShellInput = { loaded: true, signedIn: true, hasTeam: false, memberships: false, membershipsKnown: true, pathname: "/dashboard", isPlatformOwner: false };
const route = (over: Partial<ShellInput>) => resolveShellRoute({ ...base, ...over });

// Every app path the shell can be asked about: each segment, a sub-path of each, plus the setup route, the root and a path nobody owns.
const PATHS = ["/", ...APP_SEGMENTS.flatMap((s) => [`/${s}`, `/${s}/x`]), "/credits", "/credits/x", "/nowhere", "/admin/anything"];

describe("resolveShellRoute: the shell's whole routing rule", () => {
  it("waits while auth loads, and a signed-out visitor goes to the login", () => {
    expect(route({ loaded: false })).toEqual({ render: "loading", redirect: null });
    expect(route({ signedIn: false })).toEqual({ render: "loading", redirect: "/login" });
  });

  it("memberships OFF: no team means the setup screen and nothing else, exactly as before", () => {
    for (const pathname of PATHS) {
      const r = route({ pathname, memberships: false });
      if (pathname === SETUP_PATH) expect(r, pathname).toEqual({ render: "setup", redirect: null });
      else expect(r, pathname).toEqual({ render: "loading", redirect: SETUP_PATH });
    }
  });

  it("memberships OFF: a person with a team is never offered the setup route; it moves them to the dashboard", () => {
    expect(route({ hasTeam: true, pathname: SETUP_PATH })).toEqual({ render: "loading", redirect: "/dashboard" });
    for (const pathname of PATHS.filter((p) => p !== SETUP_PATH)) expect(route({ hasTeam: true, pathname }), pathname).toEqual({ render: "team", redirect: null });
  });

  it("memberships ON: a person with a team keeps the full shell, including the join screen for another team", () => {
    for (const pathname of PATHS) expect(route({ hasTeam: true, memberships: true, pathname }), pathname).toEqual({ render: "team", redirect: null });
  });

  it("memberships ON, no team: the personal pages render the personal shell and every other path goes to the dashboard", () => {
    for (const pathname of PATHS) {
      const r = route({ memberships: true, pathname });
      if (isPersonalPath(pathname, false)) expect(r, pathname).toEqual({ render: "personal", redirect: null });
      else expect(r, pathname).toEqual({ render: "loading", redirect: "/dashboard" });
    }
  });

  it("the personal pages are exactly the agreed list; the Admin Panel is the platform owner's alone", () => {
    expect([...PERSONAL_PATHS]).toEqual(["/dashboard", "/practice-scouting", "/profile", "/achievements", "/account", "/credits", "/changelog", "/apply-to-team"]);
    expect([...PERSONAL_PLATFORM_OWNER_PATHS]).toEqual(["/admin"]);
    expect(route({ memberships: true, pathname: "/admin" })).toEqual({ render: "loading", redirect: "/dashboard" });
    expect(route({ memberships: true, pathname: "/admin", isPlatformOwner: true })).toEqual({ render: "personal", redirect: null });
    expect(route({ memberships: true, pathname: "/team-management", isPlatformOwner: true })).toEqual({ render: "loading", redirect: "/dashboard" });
  });

  it("team pages are never personal: scouting, analytics, assignments, people, team management and settings", () => {
    for (const p of ["/scout", "/analytics", "/assignments", "/people", "/team-management", "/team-settings", "/my-scouting", "/scout-accuracy", "/match-list", "/events", "/event"]) {
      expect(isPersonalPath(p, true), p).toBe(false);
    }
  });

  it("NEVER LOOPS: following a redirect always ends on a page that renders, for every state and path", () => {
    for (const memberships of [false, true]) {
      for (const hasTeam of [false, true]) {
        for (const isPlatformOwner of [false, true]) {
          for (const pathname of PATHS) {
            const first = route({ memberships, hasTeam, isPlatformOwner, pathname });
            if (!first.redirect) continue;
            const second = route({ memberships, hasTeam, isPlatformOwner, pathname: first.redirect });
            expect(second.redirect, `${memberships}/${hasTeam}/${isPlatformOwner} ${pathname} -> ${first.redirect}`).toBeNull();
            expect(second.render, `${pathname} -> ${first.redirect}`).not.toBe("loading");
          }
        }
      }
    }
  });

  it("an unanswered switch holds a person with no team on the spinner instead of guessing (a deep link is not bounced)", () => {
    expect(route({ membershipsKnown: false, pathname: "/practice-scouting" })).toEqual({ render: "loading", redirect: null });
    // ...but a person with a team is not held (the switch only changes the setup route for them).
    expect(route({ membershipsKnown: false, hasTeam: true, pathname: "/scout" })).toEqual({ render: "team", redirect: null });
  });

  it("a path matches itself and anything under it, not a longer name", () => {
    expect(isPersonalPath("/profile/abc", false)).toBe(true);
    expect(isPersonalPath("/profile-x", false)).toBe(false);
    expect(isPersonalPath("/dashboard?role=lead", false)).toBe(true);
  });

  it("every personal sidebar id is a real page in the nav", () => {
    const ids = new Set(NAV_PAGES.map((p) => p.id));
    for (const id of PERSONAL_PAGE_IDS) expect(ids.has(id), id).toBe(true);
  });
});
