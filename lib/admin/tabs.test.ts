import { describe, expect, it } from "vitest";
import { adminTabFromQuery, activeAdminTab } from "@/lib/admin/tabs";
import { VERIFY_ADMINS_HREF } from "@/components/assignments/past-members-section";

describe("a link can open an Admin Panel tab", () => {
  it("reads a known tab id from ?tab=, and nothing else", () => {
    expect(adminTabFromQuery("verify-admins")).toBe("verify-admins");
    expect(adminTabFromQuery("nonsense")).toBeNull();
    expect(adminTabFromQuery(null)).toBeNull();
  });
  it("opens it only when this viewer is shown it, else the first tab", () => {
    expect(activeAdminTab(["forms", "verify-admins"], "verify-admins")).toBe("verify-admins");
    expect(activeAdminTab(["forms"], "verify-admins")).toBe("forms");
  });
  it("the Past Team Members hint links to a tab that exists", () => {
    expect(adminTabFromQuery(new URLSearchParams(VERIFY_ADMINS_HREF.split("?")[1]).get("tab"))).toBe("verify-admins");
  });
});
