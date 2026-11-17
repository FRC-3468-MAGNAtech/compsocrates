import { describe, expect, it, vi } from "vitest";
import { scrollToTopInstantly, shouldResetScroll } from "@/lib/scroll-reset";

const base = { prevPathname: "/frc/scout", pathname: "/frc/analytics", traversal: false, hash: "" };

describe("shouldResetScroll", () => {
  it("resets on a new page", () => {
    expect(shouldResetScroll(base)).toBe(true);
  });

  it("resets when only the program or an event segment changes", () => {
    expect(shouldResetScroll({ ...base, pathname: "/ftc/scout" })).toBe(true);
    expect(shouldResetScroll({ ...base, prevPathname: "/frc/event/2026abc", pathname: "/frc/event/2026xyz" })).toBe(true);
  });

  it("does not reset on first render or when the path is unchanged (tabs, filters, query params)", () => {
    expect(shouldResetScroll({ ...base, prevPathname: null })).toBe(false);
    expect(shouldResetScroll({ ...base, pathname: base.prevPathname })).toBe(false);
  });

  it("does not reset on Back / Forward", () => {
    expect(shouldResetScroll({ ...base, traversal: true })).toBe(false);
  });

  it("does not reset for a hash link, but a bare # still counts as a page change", () => {
    expect(shouldResetScroll({ ...base, hash: "#section" })).toBe(false);
    expect(shouldResetScroll({ ...base, hash: "#" })).toBe(true);
  });
});

describe("scrollToTopInstantly", () => {
  it("scrolls to the origin without animation", () => {
    const scrollTo = vi.fn();
    scrollToTopInstantly({ scrollTo } as unknown as Window);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "instant" });
  });
});
