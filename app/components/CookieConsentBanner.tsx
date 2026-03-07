"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  dismissCookieBannerInSession,
  isCookieBannerDismissed,
  readCookieConsent,
  writeCookieConsent,
} from "@/app/utils/cookieConsent";

let dismissedInMemory = false;

function shouldShowCookieBanner() {
  if (typeof window === "undefined") return false;
  return !dismissedInMemory && !isCookieBannerDismissed() && readCookieConsent() === null;
}

export default function CookieConsentBanner() {
  const [visible, setVisible] = useState(() => shouldShowCookieBanner());

  useEffect(() => {
    function onConsentChanged(event: Event) {
      const detail = (event as CustomEvent<unknown>).detail;
      if (detail === "accepted" || detail === "rejected") {
        dismissedInMemory = true;
        setVisible(false);
        return;
      }
      if (detail === null) {
        dismissedInMemory = false;
      }
      setVisible(shouldShowCookieBanner());
    }

    window.addEventListener("cookie-consent-changed", onConsentChanged as EventListener);
    return () => {
      window.removeEventListener("cookie-consent-changed", onConsentChanged as EventListener);
    };
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] border-t bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-gray-700">
          We use essential auth/session storage and optional preference cookies. See our{" "}
          <Link href="/privacy-policy" className="underline">
            Privacy Policy
          </Link>
          .
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded border border-gray-300 px-3 py-2 text-sm"
            onClick={() => {
              dismissCookieBannerInSession();
              dismissedInMemory = true;
              setVisible(false);
              try {
                writeCookieConsent("rejected");
              } catch {
                // Keep banner dismissed for this runtime even if persistence APIs fail.
              }
            }}
          >
            Reject Optional
          </button>
          <button
            type="button"
            className="rounded px-3 py-2 text-sm text-white"
            style={{ backgroundColor: "var(--primary-color)" }}
            onClick={() => {
              dismissCookieBannerInSession();
              dismissedInMemory = true;
              setVisible(false);
              try {
                writeCookieConsent("accepted");
              } catch {
                // Keep banner dismissed for this runtime even if persistence APIs fail.
              }
            }}
          >
            Accept All
          </button>
        </div>
      </div>
    </div>
  );
}
