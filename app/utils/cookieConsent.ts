export const COOKIE_CONSENT_COOKIE = "compsocrates_cookie_consent";
export const COOKIE_CONSENT_STORAGE = "compsocrates_cookie_consent";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export type CookieConsentValue = "accepted" | "rejected";

export function readCookieConsent(): CookieConsentValue | null {
  if (typeof document !== "undefined") {
    try {
      const parts = document.cookie.split(";").map((chunk) => chunk.trim());
      for (const part of parts) {
        if (!part.startsWith(`${COOKIE_CONSENT_COOKIE}=`)) continue;
        const value = decodeURIComponent(part.slice(COOKIE_CONSENT_COOKIE.length + 1));
        if (value === "accepted" || value === "rejected") return value;
      }
    } catch {
      // Best-effort read.
    }
  }

  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem(COOKIE_CONSENT_STORAGE);
      if (stored === "accepted" || stored === "rejected") return stored;
    } catch {
      // Best-effort read.
    }
  }
  return null;
}

export function writeCookieConsent(value: CookieConsentValue) {
  if (typeof document !== "undefined") {
    try {
      document.cookie = `${COOKIE_CONSENT_COOKIE}=${encodeURIComponent(value)}; Max-Age=${ONE_YEAR_SECONDS}; Path=/; SameSite=Lax`;
    } catch {
      // Best-effort write.
    }
  }
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(COOKIE_CONSENT_STORAGE, value);
    } catch {
      // Best-effort write.
    }
    window.dispatchEvent(new CustomEvent("cookie-consent-changed", { detail: value }));
  }
}

export function clearCookieConsent() {
  if (typeof document !== "undefined") {
    try {
      document.cookie = `${COOKIE_CONSENT_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
    } catch {
      // Best-effort clear.
    }
  }
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(COOKIE_CONSENT_STORAGE);
    } catch {
      // Best-effort clear.
    }
    window.dispatchEvent(new CustomEvent("cookie-consent-changed", { detail: null }));
  }
}
