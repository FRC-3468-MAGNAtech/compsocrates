import "server-only";
import { ftcApiBaseUrl, ftcApiCredentials } from "@/lib/server/env";

// FTC Events API access. Keys and the base URL come from lib/server/env.ts (the only reader of environment variables).

export const FTC_API_BASE_URL = ftcApiBaseUrl();

export function getFtcCredentials() {
  return ftcApiCredentials();
}

/** FTC seasons run roughly Sept-Apr and are named for the year they start in. */
export function getDefaultSeason(now: Date = new Date()): number {
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed; 8 = September
  return month >= 8 ? year : year - 1;
}

export function getSelectableSeasons(now: Date = new Date()): number[] {
  const current = getDefaultSeason(now);
  return [current + 1, current, current - 1, current - 2];
}
