import { EVENT_CONFIG, type EventProgram } from "@/config/event";

/**
 * One registry every season-select screen reads from — adding a season
 * later is adding one entry here, nothing else.
 */
export type Season = {
  id: string;
  name: string;
  /** The FIRST API's own season year (e.g. 2026 for the 2026-27 season) — see docs/ASSUMPTIONS.md (P3) for how BIOBUZZ's was determined. */
  apiSeason: number;
  /** Matches a lib/scout-form/schema.ts registry key (P2). */
  formId: string;
  enabled: boolean;
  /** Which event program plays this game (config/event.ts). */
  program: EventProgram;
  /**
   * A retired game kept so its old entries stay readable (docs/ROUTES.md D3: REEFSCAPE and CHARGED UP, as CS disabled their submit paths). Its form can
   * be resolved by id for analytics and history but is never offered for a new entry: pickers read `getEnabledSeasons()`, which leaves it out. Only the
   * analytics Game filter reads `getAnalyticsSeasons()`.
   */
  readOnly?: boolean;
};

export const SEASONS: Season[] = [
  { id: "rebuilt", name: "REBUILT", apiSeason: 2026, formId: "rebuilt", enabled: true, program: "frc" },
  { id: "reefscape", name: "REEFSCAPE", apiSeason: 2025, formId: "reefscape", enabled: true, program: "frc", readOnly: true },
  { id: "charged_up", name: "CHARGED UP", apiSeason: 2023, formId: "charged_up", enabled: true, program: "frc", readOnly: true },
  { id: "biobuzz", name: "BIOBUZZ", apiSeason: 2026, formId: "biobuzz", enabled: true, program: "ftc" },
];

/** The season of the running program: REBUILT for FRC (the default), BIOBUZZ when `EVENT_PROGRAM=ftc`. */
export function seasonIdForProgram(program: EventProgram): string {
  return program === "ftc" ? "biobuzz" : "rebuilt";
}

export const DEFAULT_SEASON_ID = seasonIdForProgram(EVENT_CONFIG.program);

export function getSeason(id: string = DEFAULT_SEASON_ID): Season {
  return SEASONS.find((s) => s.id === id) ?? SEASONS.find((s) => s.id === DEFAULT_SEASON_ID) ?? SEASONS[0];
}

/** Seasons a new entry can be scouted for (practice, the match library, assignments). Read-only legacy games are not among them. */
export function getEnabledSeasons(): Season[] {
  return SEASONS.filter((s) => s.enabled && !s.readOnly);
}

/** Seasons whose entries can be viewed: every enabled one, legacy included. The analytics Game filter reads this. */
export function getAnalyticsSeasons(): Season[] {
  return SEASONS.filter((s) => s.enabled);
}

export const isReadOnlySeason = (id: string): boolean => SEASONS.some((s) => s.id === id && s.readOnly === true);
