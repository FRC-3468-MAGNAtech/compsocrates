/**
 * The single place that says what this app is called and how it presents itself: names, taglines, copy, storage
 * prefix and logo slots. Every user-visible brand string, every browser-storage key and every exported-file marker reads
 * from here, so renaming the product (or merging this app with a sister app) is a change to this file, not a search
 * through the code.
 *
 * Pure data: no `server-only`, no Node APIs, safe to import from client code.
 */

export const BRAND = {
  /** The product name, as shown in navigation, emails and page titles. */
  name: "CompSocrates",
  /** The browser tab title and the app title when added to a home screen (CS's own). */
  title: "CompSocrates Scouting",
  /** Short headline used on the landing page. */
  tagline: "Strategic Scouting for FRC Teams",
  /** One-sentence description for the landing page and the web app manifest. */
  description:
    "CompSocrates is the modern scouting platform that helps FIRST Robotics Competition teams make data-driven decisions. Track performance, analyze trends, and dominate the competition.",
  /** `<meta name="description">`. */
  metaDescription: "Scouting website for robotics competitions",
  /** Production domain, without a scheme. Used in placeholders and embed parent hosts. */
  domain: "compsocrates.com",
  /** Shown in the footer after the copyright sign. */
  copyrightHolder: "CompSocrates",
  /** Display name on outgoing email ("CompSocrates <notify@your-domain>"). */
  emailSenderName: "CompSocrates",

  /**
   * Prefix for every localStorage key, IndexedDB database name and similar browser-side identifier
   * (`${storagePrefix}.theme`, `${storagePrefix}-photo-uploads`). Lowercase, no spaces.
   */
  storagePrefix: "compsocrates",
  /** Marker written into exported form files and checked on import. */
  exportFormat: "compsocrates-form",
  /** Prefix for downloaded file names (`${filePrefix}-backup-<team>-<time>.json`). */
  filePrefix: "compsocrates",

  /** Web app manifest colors (the default theme's page color). */
  themeColor: "#17070c",

  /**
   * Logo slots, as public URL paths. Only the browser-tab icon is set: the product has no official logo artwork yet, and
   * the navigation, login and loading screens show the text name. Set a slot to a path under `public/` when official
   * artwork exists and the places that read it pick it up. `null` means "not available, render nothing or the text name".
   */
  logo: {
    /** The browser-tab icon (also the file Next.js serves as `/favicon.ico`). */
    favicon: "/favicon.ico" as string | null,
    /** The mark shown beside the name in navigation, login and loading screens. */
    mark: null as string | null,
    /** The mark for dark surfaces, if it differs from `mark`. */
    markDark: null as string | null,
    /** iOS home-screen icon (180x180 PNG). */
    apple: null as string | null,
    /** Web app manifest icons (the install prompt needs both a 192px and a 512px PNG). */
    pwa192: null as string | null,
    pwa512: null as string | null,
    pwaMaskable512: null as string | null,
    /** Social preview image (1200x630). */
    og: null as string | null,
  },
} as const;

export type Brand = typeof BRAND;

/** `compsocrates.theme`, `compsocrates.colorMode`, ... one place to build browser-storage keys. */
export function storageKey(name: string): string {
  return `${BRAND.storagePrefix}.${name}`;
}
