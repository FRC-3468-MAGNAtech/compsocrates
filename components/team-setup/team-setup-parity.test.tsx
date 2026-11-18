import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ logout: async () => {} }) }));
vi.mock("@/components/program/program-switcher", () => ({ ProgramSwitcher: () => <div data-testid="switcher" /> }));

import { PROGRAMS } from "@/config/programs";
import { PROGRAM_IDS, type ProgramId } from "@/config/programs/types";
import { ProgramSetupFrame } from "@/components/program/setup-frame";
import { TeamSetupView, type TeamSetupViewProps } from "@/components/team-setup/team-setup-screen";
import type { TeamApplication } from "@/lib/applications-client";
import type { PendingJoinRequest } from "@/lib/team-setup-client";

/**
 * PARITY: the Join / Apply screen is ONE component, so FRC and FTC must draw it word for word and box for box. This renders it for every program in every state
 * and requires the same markup once the program's own label and full name (the only things config supplies) are swapped for placeholders.
 */
const NOW = 1_700_000_000_000;
const noop = async () => {};
const req = (teamId: string, status: PendingJoinRequest["status"] = "pending"): PendingJoinRequest => ({ id: `r-${teamId}`, teamId, teamLabel: `Team ${teamId}`, role: "match-scout", status, createdAtMs: NOW });
const app = (program: ProgramId, status: TeamApplication["status"], over: Partial<TeamApplication> = {}): TeamApplication => ({
  id: "a1",
  program,
  applicantUid: "u1",
  applicantName: "Ada",
  applicantEmail: "ada@example.org",
  teamNumber: 1234,
  teamName: "Robo Owls",
  officialTeamName: null,
  role: "match-scout",
  verification: "x".repeat(30),
  link: null,
  status,
  rejectionReason: status === "rejected" ? "Please link your team page." : null,
  createdAtMs: NOW - 1000,
  expiresAtMs: NOW + 86_400_000,
  decidedAtMs: null,
  teamId: null,
  ...over,
});

const base = (program: ProgramId, over: Partial<TeamSetupViewProps> = {}): TeamSetupViewProps => ({
  stage: "form",
  programLabel: PROGRAMS[program].brand.label,
  greeting: "Hi, Ada",
  hasTeam: false,
  defaultName: "Ada",
  applications: "open",
  requests: [],
  application: null,
  nowMs: NOW,
  cancelingTeam: null,
  cancelError: null,
  onCancel: () => {},
  onSendAnother: () => {},
  onApplyAgain: () => {},
  onJoinInstead: () => {},
  onJoin: noop,
  onApply: () => {},
  ...over,
});

/** The screen for one program, inside the shared frame, with that program's label and full name replaced by placeholders. */
function drawn(program: ProgramId, over: (p: ProgramId) => Partial<TeamSetupViewProps>): string {
  const { label, fullName } = PROGRAMS[program].brand;
  const out = renderToStaticMarkup(
    <ProgramSetupFrame>
      <TeamSetupView {...base(program, over(program))} />
    </ProgramSetupFrame>
  );
  // The program's id is config data too (a link to its own dashboard).
  return out.replaceAll(fullName, "<full>").replaceAll(label, "<label>").replaceAll(`/${program}/`, "/<program>/");
}

const STATES: Record<string, (p: ProgramId) => Partial<TeamSetupViewProps>> = {
  loading: () => ({ stage: "loading" }),
  "join idle": () => ({}),
  "join idle, applications loading": () => ({ applications: "loading" }),
  "join with the last request denied": () => ({ requests: [req("ABCD2345", "denied")] }),
  "join with the last request canceled": () => ({ requests: [req("ABCD2345", "canceled")] }),
  "join another (has a team)": () => ({ hasTeam: true }),
  "apply, open": () => ({ initialMode: "apply", applications: "open" }),
  "apply, closed": () => ({ initialMode: "apply", applications: "closed" }),
  "one request waiting": () => ({ stage: "pending", requests: [req("ABCD2345")] }),
  "two requests waiting, one canceling": () => ({ stage: "pending", requests: [req("ABCD2345"), req("WXYZ6789")], cancelingTeam: "WXYZ6789" }),
  "cancel failed": () => ({ stage: "pending", requests: [req("ABCD2345")], cancelError: "Couldn't cancel that request. Try again." }),
  "application pending": (p) => ({ stage: "application", application: app(p, "pending") }),
  "application approved": (p) => ({ stage: "application", application: app(p, "approved") }),
  "application rejected": (p) => ({ stage: "application", application: app(p, "rejected") }),
  "application expired": (p) => ({ stage: "application", application: app(p, "pending", { expiresAtMs: NOW - 1 }) }),
};

describe("the Join / Apply screen is the same in every program, state by state", () => {
  it("there are at least two programs to compare", () => {
    expect(PROGRAM_IDS.length).toBeGreaterThanOrEqual(2);
  });

  for (const [name, state] of Object.entries(STATES)) {
    it(`${name}: identical markup in every program`, () => {
      const [first, ...rest] = PROGRAM_IDS.map((p) => drawn(p, state));
      for (const other of rest) expect(other).toBe(first);
    });
  }

  it("every state sits inside the frame, with Sign out under it", () => {
    for (const [name, state] of Object.entries(STATES)) {
      const out = drawn("frc", state);
      expect(out, name).toContain("Sign out");
    }
  });
});

describe("what the screen says (the FTC wording is the reference)", () => {
  const out = (name: string) => drawn("ftc", STATES[name]);

  it("Request sent: the code, the approval line, Cancel request and Send another request, in both programs", () => {
    const html = out("one request waiting");
    expect(html).toContain("Request sent");
    expect(html).toContain("Request sent for code ABCD2345. A team admin has to approve it. This page moves on by itself once they do.");
    expect(html).toContain("Cancel request");
    expect(html).toContain("Send another request");
  });

  it("the sentence about accounts moved from the previous site is gone", () => {
    for (const name of Object.keys(STATES)) expect(out(name)).not.toContain("moved from the previous");
  });

  it("the Apply tab is Apply for a team; the old Create a team is gone; closed and open read the same in both programs", () => {
    expect(out("apply, closed")).toContain("aren&#x27;t open yet");
    expect(out("apply, open")).toContain("Continue to application");
    for (const name of Object.keys(STATES)) {
      expect(out(name)).not.toContain("Create a team");
      expect(out(name)).not.toContain("Apply to create a team");
    }
  });

  it("denied and canceled notices", () => {
    expect(out("join with the last request denied")).toContain("Your last join request was denied.");
    expect(out("join with the last request canceled")).toContain("You canceled your last join request.");
  });

  it("the Join form is a code and a name, with the placeholder the FTC screen had", () => {
    const html = out("join idle");
    expect(html).toContain("Team join code");
    expect(html).toContain("Ask your team admin");
    expect(html).toContain("Send request");
  });
});
