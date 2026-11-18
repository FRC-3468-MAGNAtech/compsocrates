import { BRAND } from "@/config/brand";

/**
 * Platform-level copy: text that belongs to the whole site, not to one program. The footer credit lives here because it names the teams behind
 * both programs, so it cannot sit in a program file and must not be a literal in a component (the brand guard allows this one file to name both).
 */
/** The most ACTIVE team memberships one account may hold, across both programs together (enforced server-side when a membership is created or reactivated). */
export const MAX_ACTIVE_MEMBERSHIPS = 5;

/** The most join requests one account may have PENDING at once in one program (one per team). A request to a team that already has a pending one, or a sixth, is refused (409). */
export const MAX_PENDING_JOIN_REQUESTS = 5;

export const PLATFORM = {
  /** Same value as `MAX_ACTIVE_MEMBERSHIPS`, for readers that take the platform object. */
  maxActiveMemberships: MAX_ACTIVE_MEMBERSHIPS,
  footer: {
    /** The name after the copyright year; it links to `holderHref`. */
    holder: BRAND.copyrightHolder,
    /** Where the holder's name links (opens in a new tab). */
    holderHref: "https://www.magnatech3468.com/",
    /** The teams behind the platform, shown after the holder. */
    teams: "FRC Team 3468 & FTC Teams 35792 + 35794",
  },
} as const;
