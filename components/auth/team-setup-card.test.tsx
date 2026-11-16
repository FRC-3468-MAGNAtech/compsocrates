import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ logout: async () => {} }) }));

import { TeamSetupCard, type TeamSetupCardProps } from "./team-setup-card";

const html = (node: React.ReactNode) => renderToString(node).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
const noop = async () => {};
const props = (over: Partial<TeamSetupCardProps> = {}): TeamSetupCardProps => ({ programLabel: "AAA", creation: "open", defaultName: "Ada", onJoin: noop, onCreate: noop, onApply: () => {}, ...over });

describe("TeamSetupCard (the one setup screen of both programs)", () => {
  it("opens on Join a team, with Create a team second, and the join form is a code and a name", () => {
    const out = html(<TeamSetupCard {...props()} />);
    expect(out.indexOf("Join a team")).toBeGreaterThan(-1);
    expect(out.indexOf("Join a team")).toBeLessThan(out.indexOf("Create a team"));
    expect(out).toContain("Team join code");
    expect(out).toContain("Your name");
    expect(out).toContain('value="Ada"');
    expect(out).toContain("Send request");
    expect(out).not.toContain("Your role"); // the role is asked on the create form, not the join form
  });

  it("two programs render the same screen: only the program's name differs", () => {
    const a = html(<TeamSetupCard {...props({ programLabel: "AAA" })} />).replaceAll("AAA", "<label>");
    const b = html(<TeamSetupCard {...props({ programLabel: "BBB" })} />).replaceAll("BBB", "<label>");
    expect(a).toBe(b);
  });

  it("applying instead of creating changes only the Create tab's name", () => {
    expect(html(<TeamSetupCard {...props({ creation: "apply" })} />)).toContain("Apply to create a team");
    expect(html(<TeamSetupCard {...props({ creation: "open" })} />)).toContain("Create a team");
  });

  it("creation closed with no application: the same notice for every program, with the Join tab untouched", () => {
    const a = html(<TeamSetupCard {...props({ programLabel: "AAA", creation: "closed" })} />).replaceAll("AAA", "<label>");
    const b = html(<TeamSetupCard {...props({ programLabel: "BBB", creation: "closed" })} />).replaceAll("BBB", "<label>");
    expect(a).toBe(b);
    expect(a).toContain("Create a team");
    expect(a).toContain("Join a team");
    expect(a).toContain("Team join code");
  });

  it("without a program name the heading just says your team", () => {
    expect(html(<TeamSetupCard {...props({ programLabel: undefined })} />)).toContain("Set up your team");
  });
});
