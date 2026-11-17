import { BRAND } from "@/config/brand";

/**
 * Platform-level copy: text that belongs to the whole site, not to one program. The footer credit lives here because it names the teams behind
 * both programs, so it cannot sit in a program file and must not be a literal in a component (the brand guard allows this one file to name both).
 */
export const PLATFORM = {
  footer: {
    /** The name after the copyright year; it links to `holderHref`. */
    holder: BRAND.copyrightHolder,
    /** Where the holder's name links (opens in a new tab). */
    holderHref: "https://www.magnatech3468.com/",
    /** The teams behind the platform, shown after the holder. */
    teams: "FRC Team 3468 & FTC Teams 35792 + 35794",
  },
} as const;
