"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readCookieConsent, writeCookieConsent } from "@/app/utils/cookieConsent";

export default function CookieConsentBanner() {
  const [visible, setVisible] = useState(() => readCookieConsent() === null);

  useEffect(() => {
    function onConsentChanged() {
      setVisible(readCookieConsent() === null);
    }
    window.addEventListener("cookie-consent-changed", onConsentChanged as EventListener);
    return () => window.removeEventListener("cookie-consent-changed", onConsentChanged as EventListener);
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
            onClick={() => writeCookieConsent("rejected")}
          >
            Reject Optional
          </button>
          <button
            type="button"
            className="rounded px-3 py-2 text-sm text-white"
            style={{ backgroundColor: "var(--primary-color)" }}
            onClick={() => writeCookieConsent("accepted")}
          >
            Accept All
          </button>
        </div>
      </div>
    </div>
  );
}

