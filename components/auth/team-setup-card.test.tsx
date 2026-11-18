import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ logout: async () => {} }) }));

import { TeamSetupCard, type TeamSetupCardProps } from "./team-setup-card";

const html = (node: React.ReactNode) => renderToString(node).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
const noop = async () => {};
const props = (over: Partial<TeamSetupCardProps> = {}): TeamSetupCardProps => ({ programLabel: "AAA", applications: "open", defaultName: "Ada", onJoin: noop, onApply: () => {}, ...over });

describe("TeamSetupCard (the one setup card of both programs)", () => {
  it("opens on Join a team, with Apply for a team second, and the join form is a code and a name", () => {
    const out = html(<TeamSetupCard {...props()} />);
    expect(out.indexOf(">Join a team<")).toBeGreaterThan(-1);
    expect(out.indexOf(">Join a team<")).toBeLessThan(out.indexOf(">Apply for a team<"));
    expect(out).toContain("Team join code");
    expect(out).toContain("Your name");
    expect(out).toContain('value="Ada"');
    expect(out).toContain("Send request");
    expect(out).not.toContain("Your role"); // the role is only asked once a team lets joiners choose
  });

  it("two programs render the same card: only the program's name differs", () => {
    const a = html(<TeamSetupCard {...props({ programLabel: "AAA" })} />).replaceAll("AAA", "<label>");
    const b = html(<TeamSetupCard {...props({ programLabel: "BBB" })} />).replaceAll("BBB", "<label>");
    expect(a).toBe(b);
  });

  it("the old Create a team tab is gone: every new team comes from an application", () => {
    for (const applications of ["open", "closed", "loading"] as const) {
      const out = html(<TeamSetupCard {...props({ applications })} />);
      expect(out).toContain("Apply for a team");
      expect(out).not.toContain("Create a team");
      expect(out).not.toContain("Apply to create a team");
    }
  });

  it("the Join form carries no footnote about moved accounts", () => {
    expect(html(<TeamSetupCard {...props()} />)).not.toContain("moved from the previous");
  });

  it("without a program name the heading just says your team", () => {
    expect(html(<TeamSetupCard {...props({ programLabel: undefined })} />)).toContain("Set up your team");
  });

  it("a heading and description may replace the setup wording (Join another team)", () => {
    const out = html(<TeamSetupCard {...props({ heading: "Join another team", description: "Ask with a code." })} />);
    expect(out).toContain("Join another team");
    expect(out).toContain("Ask with a code.");
    expect(out).not.toContain("Set up your");
  });

  it("without a code lookup (switch OFF) the join form is exactly as before: no role select", () => {
    const out = html(<TeamSetupCard {...props()} />);
    expect(out).not.toContain("join-role-choice");
    expect(out).not.toContain("Your role on this team");
  });

  it("a notice sits above the form", () => {
    expect(html(<TeamSetupCard {...props({ notice: "You canceled your last join request." })} />)).toContain("You canceled your last join request.");
  });
});
