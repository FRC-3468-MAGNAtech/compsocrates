import { describe, expect, it } from "vitest";
import { programPath } from "@/lib/firebase/paths";
import { isPlatformPath, programHref, scopedKey, splitProgramPath } from "./paths";

describe("programHref", () => {
  it("prefixes app paths with the program", () => {
    expect(programHref("frc", "/scout")).toBe("/frc/scout");
    expect(programHref("ftc", "/analytics/rankings?x=1#a")).toBe("/ftc/analytics/rankings?x=1#a");
  });
  it("leaves platform paths, external urls and prefixed paths alone", () => {
    for (const h of ["/login", "/privacy-policy", "/", "/api/team/join", "https://x.org/a", "//cdn.x/a", "#top", "/ftc/scout"]) {
      expect(programHref("frc", h)).toBe(h);
    }
  });
});

describe("splitProgramPath", () => {
  it("splits a program segment off", () => {
    expect(splitProgramPath("/ftc/scout?a=1")).toEqual({ program: "ftc", rest: "/scout?a=1" });
    expect(splitProgramPath("/frc")).toEqual({ program: "frc", rest: "/" });
    expect(splitProgramPath("/scout")).toEqual({ program: null, rest: "/scout" });
    expect(splitProgramPath("/frcx/scout").program).toBeNull();
  });
  it("knows platform paths", () => {
    expect(isPlatformPath("/login?next=1")).toBe(true);
    expect(isPlatformPath("/scout")).toBe(false);
  });
});

describe("programPath", () => {
  it("leaves FRC paths at the root and namespaces FTC", () => {
    expect(programPath("frc", "teams")).toBe("teams");
    expect(programPath("ftc", "teams")).toBe("programs/ftc/teams");
  });
});

describe("scopedKey", () => {
  it("leaves the default program's keys alone and prefixes another program's", () => {
    expect(scopedKey("frc", "teams:2026arli:2026")).toBe("teams:2026arli:2026");
    expect(scopedKey("ftc", "teams:USTXAUS1:2025")).toBe("ftc:teams:USTXAUS1:2025");
  });
});
