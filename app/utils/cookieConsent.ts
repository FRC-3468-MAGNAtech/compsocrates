export const COOKIE_CONSENT_COOKIE = "compsocrates_cookie_consent";
export const COOKIE_CONSENT_STORAGE = "compsocrates_cookie_consent";
export const COOKIE_CONSENT_SESSION_STORAGE = "compsocrates_cookie_consent_session";
const COOKIE_BANNER_DISMISSED_COOKIE = "compsocrates_cookie_banner_dismissed";
const COOKIE_BANNER_DISMISSED_STORAGE = "compsocrates_cookie_banner_dismissed";
const COOKIE_BANNER_DISMISSED_SESSION_STORAGE = "compsocrates_cookie_banner_dismissed_session";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const WINDOW_NAME_KEY = "__compsocrates_cookie_consent__";
const WINDOW_NAME_BANNER_DISMISSED_KEY = "__compsocrates_cookie_banner_dismissed__";
const DOC_DATA_KEY = "cookieConsent";
const WINDOW_RUNTIME_KEY = "__compsocratesCookieConsent";
const WINDOW_BANNER_DISMISSED_KEY = "__compsocratesCookieBannerDismissed";
const BANNER_DISMISSED_SESSION_KEY = "__compsocrates_cookie_banner_dismissed__";

export type CookieConsentValue = "accepted" | "rejected";

type CookieWindow = Window & {
  [WINDOW_RUNTIME_KEY]?: CookieConsentValue | null;
  [WINDOW_BANNER_DISMISSED_KEY]?: boolean;
};

function readCookieValue(name: string): string {
  if (typeof document === "undefined") return "";
  try {
    const parts = document.cookie.split(";").map((chunk) => chunk.trim());
    for (const part of parts) {
      if (!part.startsWith(`${name}=`)) continue;
      return decodeURIComponent(part.slice(name.length + 1));
    }
  } catch {
    // Best-effort read.
  }
  return "";
}

function readWindowNameObject(): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(String(window.name || "{}"));
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    // Fallback below.
  }
  const raw = String(window.name || "").trim();
  if (!raw) return {};
  const fallback: Record<string, unknown> = {};
  const consentMatch = raw.match(/__compsocrates_cookie_consent__=(accepted|rejected)/i);
  if (consentMatch?.[1]) fallback[WINDOW_NAME_KEY] = consentMatch[1].toLowerCase();
  const dismissedMatch = raw.match(/__compsocrates_cookie_banner_dismissed__=(1|true)/i);
  if (dismissedMatch?.[1]) fallback[WINDOW_NAME_BANNER_DISMISSED_KEY] = "1";
  return fallback;
}

export function isCookieBannerDismissed(): boolean {
  if (typeof window === "undefined") return false;
  if ((window as CookieWindow)[WINDOW_BANNER_DISMISSED_KEY] === true) return true;
  try {
    if (window.localStorage.getItem(COOKIE_BANNER_DISMISSED_STORAGE) === "1") return true;
  } catch {
    // Best-effort read.
  }
  try {
    return window.sessionStorage.getItem(BANNER_DISMISSED_SESSION_KEY) === "1";
  } catch {
    // Best-effort read.
  }
  try {
    if (window.sessionStorage.getItem(COOKIE_BANNER_DISMISSED_SESSION_STORAGE) === "1") return true;
  } catch {
    // Best-effort read.
  }
  if (readCookieValue(COOKIE_BANNER_DISMISSED_COOKIE) === "1") return true;
  const parsed = readWindowNameObject();
  return String(parsed[WINDOW_NAME_BANNER_DISMISSED_KEY] || "").trim() === "1";
}

export function dismissCookieBannerInSession() {
  if (typeof window === "undefined") return;
  (window as CookieWindow)[WINDOW_BANNER_DISMISSED_KEY] = true;
  if (typeof document !== "undefined") {
    try {
      document.cookie = `${COOKIE_BANNER_DISMISSED_COOKIE}=1; Max-Age=${ONE_YEAR_SECONDS}; Path=/; SameSite=Lax`;
    } catch {
      // Best-effort write.
    }
  }
  try {
    window.localStorage.setItem(COOKIE_BANNER_DISMISSED_STORAGE, "1");
  } catch {
    // Best-effort write.
  }
  try {
    window.sessionStorage.setItem(BANNER_DISMISSED_SESSION_KEY, "1");
  } catch {
    // Best-effort persist.
  }
  try {
    window.sessionStorage.setItem(COOKIE_BANNER_DISMISSED_SESSION_STORAGE, "1");
  } catch {
    // Best-effort persist.
  }
  try {
    const parsed = readWindowNameObject();
    parsed[WINDOW_NAME_BANNER_DISMISSED_KEY] = "1";
    window.name = JSON.stringify(parsed);
  } catch {
    // Best-effort persist.
  }
}

export function readCookieConsent(): CookieConsentValue | null {
  if (typeof window !== "undefined") {
    const runtime = (window as CookieWindow)[WINDOW_RUNTIME_KEY];
    if (runtime === "accepted" || runtime === "rejected") return runtime;
  }

  if (typeof document !== "undefined") {
    const marker = String(document.documentElement.dataset[DOC_DATA_KEY] || "").trim();
    if (marker === "accepted" || marker === "rejected") return marker;
  }

  {
    const value = readCookieValue(COOKIE_CONSENT_COOKIE);
    if (value === "accepted" || value === "rejected") return value;
  }

  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem(COOKIE_CONSENT_STORAGE);
      if (stored === "accepted" || stored === "rejected") return stored;
    } catch {
      // Best-effort read.
    }
    try {
      const stored = window.sessionStorage.getItem(COOKIE_CONSENT_SESSION_STORAGE);
      if (stored === "accepted" || stored === "rejected") return stored;
    } catch {
      // Best-effort read.
    }
    const parsed = readWindowNameObject();
    const value = String(parsed[WINDOW_NAME_KEY] || "").trim();
    if (value === "accepted" || value === "rejected") return value;
  }
  return null;
}

export function writeCookieConsent(value: CookieConsentValue) {
  if (typeof window !== "undefined") {
    (window as CookieWindow)[WINDOW_RUNTIME_KEY] = value;
    dismissCookieBannerInSession();
  }
  if (typeof document !== "undefined") {
    document.documentElement.dataset[DOC_DATA_KEY] = value;
  }
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
    try {
      window.sessionStorage.setItem(COOKIE_CONSENT_SESSION_STORAGE, value);
    } catch {
      // Best-effort write.
    }
    try {
      const parsed = readWindowNameObject();
      parsed[WINDOW_NAME_KEY] = value;
      parsed[WINDOW_NAME_BANNER_DISMISSED_KEY] = "1";
      window.name = JSON.stringify(parsed);
    } catch {
      // Best-effort write.
    }
    try {
      window.dispatchEvent(new CustomEvent("cookie-consent-changed", { detail: value }));
    } catch {
      // Best-effort notify.
    }
  }
}

export function clearCookieConsent() {
  if (typeof window !== "undefined") {
    (window as CookieWindow)[WINDOW_RUNTIME_KEY] = null;
    (window as CookieWindow)[WINDOW_BANNER_DISMISSED_KEY] = false;
    try {
      window.sessionStorage.removeItem(BANNER_DISMISSED_SESSION_KEY);
    } catch {
      // Best-effort clear.
    }
    try {
      window.localStorage.removeItem(COOKIE_BANNER_DISMISSED_STORAGE);
    } catch {
      // Best-effort clear.
    }
    try {
      window.sessionStorage.removeItem(COOKIE_BANNER_DISMISSED_SESSION_STORAGE);
    } catch {
      // Best-effort clear.
    }
  }
  if (typeof document !== "undefined") {
    delete document.documentElement.dataset[DOC_DATA_KEY];
  }
  if (typeof document !== "undefined") {
    try {
      document.cookie = `${COOKIE_CONSENT_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
    } catch {
      // Best-effort clear.
    }
    try {
      document.cookie = `${COOKIE_BANNER_DISMISSED_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
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
    try {
      window.sessionStorage.removeItem(COOKIE_CONSENT_SESSION_STORAGE);
    } catch {
      // Best-effort clear.
    }
    try {
      const parsed = readWindowNameObject();
      delete parsed[WINDOW_NAME_KEY];
      delete parsed[WINDOW_NAME_BANNER_DISMISSED_KEY];
      window.name = JSON.stringify(parsed);
    } catch {
      // Best-effort clear.
    }
    try {
      window.dispatchEvent(new CustomEvent("cookie-consent-changed", { detail: null }));
    } catch {
      // Best-effort notify.
    }
  }
}
