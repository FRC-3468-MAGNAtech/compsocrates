import { afterEach, describe, expect, it, vi } from "vitest";
import { FtcApiError, ftcFetch } from "./http";

const rejection = (promise: Promise<unknown>) => promise.then(() => null, (e: unknown) => e as FtcApiError);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("FTC key problems name both variables and never a value", () => {
  it("missing keys: a typed missing_credentials error naming FTC_API_USERNAME and FTC_API_KEY, without calling out", async () => {
    vi.stubEnv("FTC_API_USERNAME", "");
    vi.stubEnv("FTC_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const error = await rejection(ftcFetch("/2026/events"));
    expect(error?.code).toBe("missing_credentials");
    expect(error?.message).toMatch(/FTC_API_USERNAME/);
    expect(error?.message).toMatch(/FTC_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a rejected key (401 or 403): unauthorized, names both variables, and carries neither the username nor the key", async () => {
    vi.stubEnv("FTC_API_USERNAME", "secret-user-value");
    vi.stubEnv("FTC_API_KEY", "secret-key-value");
    for (const status of [401, 403]) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status })));
      const error = await rejection(ftcFetch(`/2026/events/${status}`));
      expect(error?.code).toBe("unauthorized");
      expect(error?.message).toMatch(/FTC_API_USERNAME/);
      expect(error?.message).toMatch(/FTC_API_KEY/);
      expect(error?.message).not.toMatch(/secret-user-value|secret-key-value/);
    }
  });
});
