import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SubmissionLockoutBanner } from "@/components/forms/submission-lockout";
import { ScoutForm } from "@/components/scout/scout-form";
import { ConfirmDialog } from "@/components/scout/confirm-dialog";
import { RequestSubIn } from "@/components/sub-ins/request-sub-in";
import { SubInRequestsPanel } from "@/components/sub-ins/sub-in-requests-panel";
import { REBUILT_FORM } from "@/lib/forms/builtin-rebuilt";
import { buildSubInRequest, claimPatch, type SubInRequest } from "@/lib/sub-ins/model";

const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/&#x27;/g, "'");
const noop = () => {};

describe("Match Scout Form: lockout", () => {
  const html = (locked: boolean) => text(renderToString(<ScoutForm schema={REBUILT_FORM} mode="event" lockout={{ locked, reason: "Judging is in progress." }} prefill={{ scoutName: "Ann" }} subInControl={<span data-testid="sub-in-slot">Request Sub-In</span>} />));

  it("a locked team sees the banner with the reason and a disabled Submit", () => {
    const out = html(true);
    expect(out).toContain('data-testid="lockout-banner"');
    expect(out).toContain("Submissions are currently disabled.");
    expect(out).toContain("Judging is in progress.");
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*data-testid="scout-submit"|<button[^>]*data-testid="scout-submit"[^>]*disabled=""/);
  });

  it("an open team sees no banner and an enabled Submit", () => {
    const out = html(false);
    expect(out).not.toContain("lockout-banner");
    expect(out).not.toMatch(/<button[^>]*disabled=""[^>]*data-testid="scout-submit"/);
    expect(out).toContain("Submit match");
  });

  it("the sub-in control sits beside the match button; without one there is no fake Request Sub-In", () => {
    expect(html(false)).toContain('data-testid="sub-in-slot"');
    const without = text(renderToString(<ScoutForm schema={REBUILT_FORM} mode="event" prefill={{ scoutName: "Ann" }} />));
    expect(without).not.toContain("Request Sub-In");
  });
});

describe("lockout banner", () => {
  it("says edits still work unless told otherwise", () => {
    expect(text(renderToString(<SubmissionLockoutBanner lockout={{ locked: true, reason: "r" }} />))).toContain("You can still edit existing entries.");
    expect(text(renderToString(<SubmissionLockoutBanner lockout={{ locked: true, reason: "r" }} editAllowed={false} />))).not.toContain("edit existing");
    expect(renderToString(<SubmissionLockoutBanner lockout={{ locked: false, reason: "" }} />)).toBe("");
  });
});

describe("confirm dialog", () => {
  it("renders nothing while closed (no window.confirm anywhere)", () => {
    expect(renderToString(<ConfirmDialog open={false} onOpenChange={noop} title="t" confirmLabel="Go" onConfirm={noop} />)).toBe("");
  });
});

describe("Request Sub-In control", () => {
  it("is a 44px button, disabled until there is a team, an event and a person", () => {
    const off = text(renderToString(<RequestSubIn teamId={null} eventKey={null} actor={null} assigned={[]} requests={[]} />));
    expect(off).toContain("Request Sub-In");
    expect(off).toMatch(/disabled=""/);
    const on = text(renderToString(<RequestSubIn teamId="T" eventKey="2026arli" actor={{ uid: "u", name: "Ann" }} assigned={[]} requests={[]} />));
    expect(on).toContain("min-h-11");
    expect(on).not.toMatch(/disabled=""/);
  });
});

describe("sub-in list", () => {
  const now = 1_790_000_000_000;
  const mk = (id: string, uid: string, extra: Partial<SubInRequest> = {}): SubInRequest => ({
    id,
    ...buildSubInRequest({ teamId: "T", eventKey: "e", actor: { uid, name: uid.toUpperCase() }, target: { matchType: "Qualification", matchNumber: 7, teamNumber: 254 }, now }),
    ...extra,
  });
  const render = (requests: SubInRequest[], uid: string | null) => text(renderToString(<SubInRequestsPanel requests={requests} uid={uid} now={now + 1000} busyId={null} scoutHref="/scout?load=next" onClaim={noop} onCancel={noop} />));

  it("offers Take sub-in to others, Delete request to the requester, and hides both once taken", () => {
    const open = mk("a", "ann");
    expect(render([open], "bob")).toContain("Take sub-in");
    expect(render([open], "ann")).toContain("Delete request");
    expect(render([open], "ann")).not.toContain("Take sub-in");
    const taken = mk("b", "ann", claimPatch({ uid: "bob", name: "Bob" }, now));
    const asAnn = render([taken], "ann");
    expect(asAnn).toContain("Sub Assigned");
    expect(asAnn).toContain("Bob");
    expect(asAnn).not.toContain("Delete request");
    expect(asAnn).not.toContain("Scout now");
  });

  it("gives the scout who took it a Scout now link", () => {
    const taken = mk("b", "ann", claimPatch({ uid: "bob", name: "Bob" }, now));
    expect(render([taken], "bob")).toContain("Scout now");
    expect(render([taken], "bob")).toContain("/scout?load=next");
  });
});
