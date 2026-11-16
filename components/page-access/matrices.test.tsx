import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MembersMatrix } from "@/components/page-access/members-matrix";
import { RoleMatrix } from "@/components/page-access/role-matrix";
import { defaultPageAccessConfig, setMemberPageState, setOpenRestriction, type PageAccessConfig } from "@/lib/page-access/access";
import { accessPageGroups, type AccessPageGroup } from "@/lib/page-access/page-list";
import { normalizeEntries } from "@/lib/sidebar/layout";
import { ROLES } from "@/lib/roles";
import type { TeamMember } from "@/lib/team-members";

// The Roles chart and the All Members matrix as the SAME components for both programs: the program supplies only the pages (and the shared role list).

const frc = accessPageGroups("frc", normalizeEntries(null));
const ftc = accessPageGroups("ftc", normalizeEntries(null));
const noop = () => {};

const member = (uid: string, name: string, primaryRole: TeamMember["primaryRole"], extra: Partial<TeamMember> = {}): TeamMember => ({ uid, name, email: `${uid}@example.com`, primaryRole, secondaryRoles: [], isAdmin: false, isOwner: false, ...extra });
const MEMBERS = [member("lee", "Lee Lead", "lead-scout"), member("ada", "Ada Admin", "team-coach", { isAdmin: true }), member("sam", "Sam Scout", "match-scout", { secondaryRoles: ["pit-team"] })];

const roles = (groups: AccessPageGroup[], config: PageAccessConfig = defaultPageAccessConfig()) => renderToString(<RoleMatrix config={config} groups={groups} onToggle={noop} onToggleOpen={noop} />);
const matrix = (groups: AccessPageGroup[], members: TeamMember[] = MEMBERS, config: PageAccessConfig = defaultPageAccessConfig()) =>
  renderToString(<MembersMatrix config={config} members={members} groups={groups} onSetMemberPage={noop} onOpenRole={noop} />);

describe("Roles chart", () => {
  it("lists every page of the program, every role as a column, for both programs", () => {
    for (const groups of [frc, ftc]) {
      const html = roles(groups);
      for (const row of groups.flatMap((g) => g.rows)) expect(html, row.id).toContain(`data-page="${row.id}"`);
      for (const r of ROLES) expect(html).toContain(r.label);
    }
  });
  it("lists a page only for the program that has it (FTC has no Judge Book), with the same markup otherwise", () => {
    expect(roles(frc)).toContain('data-page="judge-book"');
    expect(roles(ftc)).not.toContain('data-page="judge-book"');
    expect(roles(ftc)).toContain('data-testid="role-matrix-search"');
    expect(roles(frc)).toContain('data-testid="role-matrix-search"');
  });
  it("shows an open page fully ticked with its label, and an unticked cell once a role is closed out", () => {
    const html = roles(frc);
    expect(html).toContain("Open to everyone by default");
    const cell = (h: string, role: string, page: string) => h.match(new RegExp(`<button[^>]*data-testid="matrix-${role}-${page}"[^>]*>`))?.[0] ?? "";
    for (const r of ROLES) expect(cell(html, r.id, "match-list")).toContain('aria-checked="true"');
    const closed = roles(frc, setOpenRestriction(defaultPageAccessConfig(), "media", "match-list", true));
    expect(cell(closed, "media", "match-list")).toContain('aria-checked="false"');
    expect(cell(closed, "team-coach", "match-list")).toContain('aria-checked="true"');
  });
  it("shows always-on pages ticked and locked with the reason, and the Admin Panel as admins only", () => {
    const html = roles(frc);
    const cell = html.match(/<button[^>]*data-testid="matrix-media-dashboard"[^>]*>/)?.[0] ?? "";
    expect(cell).toContain('aria-checked="true"');
    expect(cell).toContain("disabled");
    expect(html).toContain("landing page");
    expect(html).toContain("Always available");
    expect(html).toContain("Admins only, never given to a role");
  });
  it("warns, but allows, a role whose every page is closed", () => {
    let cfg = defaultPageAccessConfig();
    for (const g of frc) for (const r of g.rows) if (r.kind === "open") cfg = setOpenRestriction(cfg, "media", r.id, true);
    expect(roles(frc, cfg)).toContain("Media has no pages beyond the always-available ones");
    expect(roles(frc)).not.toContain("has no pages beyond");
  });
  it("has real headers (th scope) and collapsible groups", () => {
    const html = roles(frc);
    expect(html).toMatch(/<th[^>]*scope="col"/);
    expect(html).toMatch(/<th[^>]*scope="row"/);
    expect(html).toMatch(/aria-expanded="true"/);
  });
});

describe("All Members matrix", () => {
  it("has a legend, a real table with row and column headers, and an accessible name on every cell", () => {
    const html = matrix(frc);
    expect(html).toContain('data-testid="matrix-legend"');
    for (const word of ["Granted to this member", "Blocked for this member", "No access", "Always available, locked"]) expect(html).toContain(word);
    expect(html).toMatch(/<th[^>]*scope="col"/);
    expect(html).toMatch(/<th[^>]*scope="colgroup"/);
    expect(html).toMatch(/<th[^>]*scope="row"/);
    expect(html).toContain('aria-label="Lee Lead, Assignments: granted by role Lead Scout"');
    expect(html).toContain('aria-label="Sam Scout, Assignments: no access. Press to grant"');
    expect(html).toContain('aria-label="Sam Scout, Match List: open to everyone by default"');
    expect(html).toContain("pointer-coarse:h-11");
    expect(html).toContain("table-head-cell");
    expect(html).not.toContain(["backdrop", "blur"].join("-"));
  });
  it("shows each cell state: role, granted, blocked, empty, always-on, and an admin's access as role access", () => {
    const cfg = setMemberPageState(setMemberPageState(defaultPageAccessConfig(), "sam", "team-management", "grant"), "lee", "assignments", "deny");
    const html = matrix(frc, MEMBERS, cfg);
    const state = (uid: string, page: string) => html.match(new RegExp(`data-uid="${uid}" data-page="${page}"[^>]*data-state="(\\w+)"`))?.[1];
    expect(state("lee", "lead-scout-form")).toBe("role");
    expect(state("sam", "team-management")).toBe("granted");
    expect(state("lee", "assignments")).toBe("blocked");
    expect(state("sam", "assignments")).toBe("none");
    expect(state("sam", "dashboard")).toBe("always");
    expect(state("ada", "assignments")).toBe("role");
    expect(html).toContain("Ada Admin, Assignments: granted because they are an admin");
  });
  it("a closed open page is empty for that role and grey for the others", () => {
    const html = matrix(frc, [...MEMBERS, member("mia", "Mia Match", "match-scout")], setOpenRestriction(defaultPageAccessConfig(), "match-scout", "match-list", true));
    const state = (uid: string) => html.match(new RegExp(`data-uid="${uid}" data-page="match-list"[^>]*data-state="(\\w+)"`))?.[1];
    expect(state("mia")).toBe("none");
    expect(state("sam")).toBe("open"); // Sam also holds Pit Team, which is not closed out
    expect(state("lee")).toBe("open");
  });
  it("lists exactly the members it is given, sorted by name: a person who left (override still stored) is not a row", () => {
    const withStale = setMemberPageState(defaultPageAccessConfig(), "gone", "assignments", "grant");
    const html = matrix(frc, MEMBERS, withStale);
    expect(html).not.toContain('data-member="gone"');
    expect([...html.matchAll(/data-member="(\w+)"/g)].map((m) => m[1])).toEqual(["ada", "lee", "sam"]);
  });
  it("renders the same controls for both programs, with the pages the program has", () => {
    for (const groups of [frc, ftc]) {
      const html = matrix(groups);
      for (const id of ["mm-member-search", "mm-role-filter", "mm-page-search", "matrix-phone-note"]) expect(html).toContain(id);
    }
    expect(matrix(frc)).toContain('data-page="judge-book"');
    expect(matrix(ftc)).not.toContain('data-page="judge-book"');
  });
  it("empty states say what is missing", () => {
    expect(matrix(frc, [])).toContain("No active members on this team yet.");
  });
  it("renders 60 members by 40 pages, with the tab stop on one cell only", () => {
    const real = frc.flatMap((g) => g.rows);
    const rows = [...real, ...Array.from({ length: 40 - real.length }, (_, i) => ({ id: `extra-${i}`, title: `Extra ${i}`, kind: "restricted" as const }))];
    const groups: AccessPageGroup[] = [{ id: "big", label: "Everything", rows }];
    const people = Array.from({ length: 60 }, (_, i) => member(`u${i}`, `Member ${String(i).padStart(2, "0")}`, ROLES[i % ROLES.length].id));
    const start = performance.now();
    const html = matrix(groups, people);
    const ms = performance.now() - start;
    expect(rows).toHaveLength(40);
    expect(html.match(/data-cell/g)).toHaveLength(60 * 40);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(ms).toBeLessThan(3000);
  });
});
