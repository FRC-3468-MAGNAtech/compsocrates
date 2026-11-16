import { describe, expect, it } from "vitest";
import { canOfferUpload, type AvatarSettings } from "@/lib/avatar/settings";

const s = (blobHost: string | null, uploadsEnabled: boolean | null): AvatarSettings => ({ loaded: true, blobHost, uploadsEnabled });

describe("canOfferUpload (beta: uploads only when the owner's switch is explicitly on)", () => {
  it("offers the Upload option only with a Blob host AND uploadsEnabled === true", () => {
    expect(canOfferUpload(s("host.example", true))).toBe(true);
  });
  it("does not offer it when the switch is off, missing (null) or the store is not set up", () => {
    expect(canOfferUpload(s("host.example", false))).toBe(false);
    expect(canOfferUpload(s("host.example", null))).toBe(false);
    expect(canOfferUpload(s(null, true))).toBe(false);
    expect(canOfferUpload({ loaded: false, blobHost: null, uploadsEnabled: null })).toBe(false);
  });
});
