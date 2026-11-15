import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/team-enrollment", () => ({ fetchAdminsSeeAllProfiles: vi.fn(async () => null), setAdminsSeeAllProfiles: vi.fn(async () => {}) }));

import { AdminsSeeProfilesSetting } from "./admins-see-profiles-setting";

describe("AdminsSeeProfilesSetting", () => {
  it("is usable (not greyed out) and on while the setting is not known yet, so the owner can always turn it off", () => {
    const out = renderToString(<AdminsSeeProfilesSetting />);
    const at = out.indexOf('aria-label="Admins can see every profile on their team"');
    expect(at).toBeGreaterThan(-1);
    const tag = out.slice(out.lastIndexOf("<", at), out.indexOf(">", at) + 1);
    expect(tag).not.toMatch(/\sdisabled(=|\s|>)/);
    expect(tag).toMatch(/aria-checked="true"/);
  });
});
