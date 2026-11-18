import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DELETION_TEXT } from "@/lib/deletion/strings";

vi.mock("@/lib/reauth", () => ({ reauthMethod: () => "password", reauthenticate: async () => {} }));
const state = { enabled: true, owner: false };
vi.mock("@/lib/deletion/client", () => ({ useAccountDeletionEnabled: () => state.enabled, deletionApi: {} }));
vi.mock("@/lib/use-platform-owner-claim", () => ({ usePlatformOwnerClaim: () => state.owner }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ logout: async () => {} }) }));

import { DeleteAccountDialogBody, DeleteAccountSection } from "@/components/account/delete-account-section";

const noop = () => {};
const body = (over: Partial<Parameters<typeof DeleteAccountDialogBody>[0]> = {}) =>
  renderToStaticMarkup(<DeleteAccountDialogBody state="ask" password="" confirm="" error={null} onPassword={noop} onConfirm={noop} onSubmit={noop} onCancel={noop} onSignOut={noop} {...over} />);

describe("the Delete account dialog", () => {
  it("says what stays, what is deleted, that it cannot be undone and that the team's policy applies", () => {
    const html = body();
    for (const line of [...DELETION_TEXT.kept, ...DELETION_TEXT.deleted, DELETION_TEXT.irreversible, DELETION_TEXT.policy]) expect(html).toContain(line.replace(/'/g, "&#x27;").replace(/“/g, "“"));
    expect(html).toContain("Deleted Account");
  });

  const submitDisabled = (html: string) => (html.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? "").includes(' disabled=""');

  it("asks the person to confirm who they are and to type DELETE, and the delete button waits for it", () => {
    const empty = body();
    expect(empty).toContain("Type DELETE to confirm");
    expect(empty).toContain("Your password");
    expect(submitDisabled(empty)).toBe(true);
    expect(submitDisabled(body({ confirm: "delete" }))).toBe(true);
    expect(submitDisabled(body({ confirm: "DELETE" }))).toBe(false);
    expect(submitDisabled(body({ confirm: "DELETE", state: "working" }))).toBe(true);
  });

  it("shows an error, the working state, and the in-progress state (with the way out)", () => {
    expect(body({ error: "You are the only admin" })).toContain("You are the only admin");
    expect(body({ state: "working", confirm: "DELETE" })).toContain("Deleting…");
    const started = body({ state: "started" });
    expect(started).toContain(DELETION_TEXT.inProgressTitle);
    expect(started).toContain(DELETION_TEXT.signOut);
    expect(started).not.toContain("Type DELETE");
  });

  it("makes no legal claim", () => {
    expect(body()).not.toMatch(/\b(law|legal|gdpr|coppa|ferpa|compliant)\b/i);
  });
});

describe("the Delete account section", () => {
  it("renders nothing while the switch is OFF, and for a platform owner", () => {
    state.enabled = false;
    state.owner = false;
    expect(renderToStaticMarkup(<DeleteAccountSection />)).toBe("");
    state.enabled = true;
    state.owner = true;
    expect(renderToStaticMarkup(<DeleteAccountSection />)).toBe("");
  });

  it("shows the section with the switch ON", () => {
    state.enabled = true;
    state.owner = false;
    const html = renderToStaticMarkup(<DeleteAccountSection />);
    expect(html).toContain(DELETION_TEXT.sectionTitle);
    expect(html).toContain(DELETION_TEXT.open);
  });
});
