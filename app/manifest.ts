import type { MetadataRoute } from "next";
import { BRAND } from "@/config/brand";

// The web app manifest (P17): lets the site be added to a phone's Home Screen and run
// standalone, which iOS *requires* before it will deliver web push (FCM). It only
// describes the app; it registers no service worker, so it coexists with the Firebase
// Messaging worker already served at /firebase-messaging-sw.js (app/firebase-messaging-sw.js/route.ts).
//
// Icons come from the `logo` slots in config/brand.ts. There is no official logo artwork yet, so no icon is listed:
// browsers fall back to a generic icon, and Chrome only offers "install" once a 192px and a 512px PNG are set there.

type ManifestIcon = NonNullable<MetadataRoute.Manifest["icons"]>[number];

function manifestIcons(): ManifestIcon[] {
  const { pwa192, pwa512, pwaMaskable512 } = BRAND.logo;
  const icons: ManifestIcon[] = [];
  if (pwa192) icons.push({ src: pwa192, sizes: "192x192", type: "image/png", purpose: "any" });
  if (pwa512) icons.push({ src: pwa512, sizes: "512x512", type: "image/png", purpose: "any" });
  if (pwaMaskable512) icons.push({ src: pwaMaskable512, sizes: "512x512", type: "image/png", purpose: "maskable" });
  return icons;
}

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.title,
    short_name: BRAND.name,
    description: BRAND.description,
    // Signed-out visitors are sent to the login page from here.
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: BRAND.themeColor,
    theme_color: BRAND.themeColor,
    icons: manifestIcons(),
  };
}
