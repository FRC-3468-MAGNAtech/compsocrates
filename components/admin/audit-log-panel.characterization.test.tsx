import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Characterization (Build 4): audit rows keep their stored actor name. A deleted actor reads "Deleted Account"; an actor the roster no longer knows does not crash the panel.
const OPAQUE = "deleted-0123456789abcdef0123456789abcdef";
const entries = [
  { id: "1", teamId: "t1", uid: OPAQUE, actorName: "Deleted Account", action: "edit-entry", target: { targetUid: OPAQUE, targetName: "Deleted Account" }, before: null, after: null, createdAt: null },
  { id: "2", teamId: "t1", uid: "left-the-team", actorName: "Ada", action: "edit-entry", target: {}, before: null, after: null, createdAt: null },
];

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ profile: { teamId: "t1" } }) }));
vi.mock("@/lib/team-members", () => ({ useTeamMembers: () => ({ members: [{ uid: "u1", name: "Grace" }] }) }));
vi.mock("@/lib/audit-log", () => ({ useAuditLog: () => ({ entries }) }));

import { AuditLogPanel } from "@/components/admin/audit-log-panel";

describe("AuditLogPanel rows", () => {
  it("renders a Deleted Account actor and an actor the roster does not know", () => {
    const html = renderToStaticMarkup(<AuditLogPanel />);
    expect(html).toContain("Deleted Account");
    expect(html).toContain("Ada");
    expect(html).toContain("2 entries");
  });
});
