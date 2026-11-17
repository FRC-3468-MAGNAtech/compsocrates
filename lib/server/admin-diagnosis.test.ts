import { describe, expect, it } from "vitest";
import { serviceAccountProject } from "@/lib/server/admin-diagnosis";

describe("serviceAccountProject", () => {
  it("reads the project out of a Firebase service-account email", () => {
    expect(serviceAccountProject("firebase-adminsdk-abc12@my-project-1a2b3.iam.gserviceaccount.com")).toBe("my-project-1a2b3");
    expect(serviceAccountProject(" Name@Proj.iam.gserviceaccount.com ")).toBe("Proj");
  });
  it("is null for anything else", () => {
    for (const bad of ["", "someone@example.com", "x@proj.iam.gserviceaccount.com.evil.com", "no-at-sign"]) expect(serviceAccountProject(bad)).toBeNull();
  });
});
