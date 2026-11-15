"use client";

import { useMemo } from "react";
import { useProgramData } from "@/lib/program/data";
import { DEFAULT_SEASON_ID, getEnabledSeasons } from "@/lib/seasons";
import { importLibraryEvent, setLibraryMatchVideo, type LibraryVideo } from "@/lib/match-library";
import {
  backfillLibraryMetadata,
  countCompletedSessionsForMatch,
  createManualEvent,
  deleteManualEvent,
  deleteManualMatches,
  setMatchesPublished,
  setMatchesVideoLink,
  updateManualEvent,
  upsertManualMatches,
  type Actor,
  type BackfillResult,
  type LibraryEvent,
} from "@/lib/library/store";
import type { EventFormInput } from "@/lib/library/event-form";
import type { ValidMatch } from "@/lib/library/manual-match";
import type { CreateEventResult, LibraryImportOutcome, MatchScores, UpsertOptions, UpsertResult } from "@/lib/library/schedule";
import type { LibraryMatch } from "@/lib/match-library";

/**
 * The Match Library's writes, in ONE shape for every program: the shared panel, its dialogs, fast entry and bulk import call these and nothing else.
 * (Reads are the hooks in `lib/match-library.ts` and `lib/library/store.ts`, which already pick the program's source.) A program with a library port
 * supplies its own adapter (`ProgramData.library`); the default program's is `rootLibraryAdapter`, a thin wrapper over the existing root writes, so it
 * stores exactly what it stored before. Which optional pieces exist is `ProgramConfig.library`, never a program id.
 */
export type LibraryAdapter = {
  createEvent(actor: Actor, input: EventFormInput, seasonId: string, existing: readonly LibraryEvent[]): Promise<CreateEventResult>;
  updateEvent(actor: Actor, event: LibraryEvent, patch: Pick<EventFormInput, "name" | "date" | "sourceUrl" | "defaultVideoUrl">, matchIds: string[]): Promise<void>;
  /** Refuses (throws "Delete this event's matches first.") while the event still has matches. */
  deleteEvent(actor: Actor, event: LibraryEvent): Promise<void>;
  /** Creates or replaces hand-made matches. `keepScores` (fast entry, bulk import) leaves an already stored official score alone. */
  upsertMatches(actor: Actor, event: LibraryEvent, matches: ValidMatch[], options: UpsertOptions & { keepScores?: boolean }): Promise<UpsertResult & { skipped?: { id: string; reason: string }[] }>;
  setPublished(actor: Actor, ids: string[], published: boolean): Promise<unknown>;
  /** Sets or clears the official score of one match (only where `ProgramConfig.library.editImportedScores`). */
  setScores(actor: Actor, id: string, scores: MatchScores | null): Promise<unknown>;
  deleteMatches(actor: Actor, ids: string[]): Promise<unknown>;
  /** One YouTube link on many matches; each keeps its own start and end. */
  setVideoLink(actor: Actor, matches: Pick<LibraryMatch, "id" | "video">[], videoId: string): Promise<void>;
  /** One match's video (the inline row on an imported match); null removes it. */
  setMatchVideo(actor: Actor, id: string, video: LibraryVideo | null): Promise<void>;
  /** Fetches an event from the events API and writes it; a failure comes back as `{ ok: false, message }` with nothing lost. */
  importEvent(actor: Actor, args: { eventCode: string; seasonId: string }): Promise<LibraryImportOutcome>;
  /** The one-time stamp for documents written before publishing existed (only where `ProgramConfig.library.backfill`). */
  backfill?(actor: Pick<Actor, "uid">): Promise<BackfillResult>;
  /** How many completed practice sessions used a match, for the "editing scores changes their accuracy" warning; absent where the program has no such count. */
  countCompletedSessions?(teamId: string, matchId: string): Promise<number>;
};

/** The default program's adapter: the existing root functions, unchanged. */
export const rootLibraryAdapter: LibraryAdapter = {
  createEvent: createManualEvent,
  updateEvent: updateManualEvent,
  deleteEvent: deleteManualEvent,
  upsertMatches: (actor, event, matches, options) => upsertManualMatches(actor, event, matches, { newPublished: options.newPublished, newNeedsReview: options.newNeedsReview }),
  setPublished: setMatchesPublished,
  setScores: async () => {
    throw new Error("This program takes its scores from the events API.");
  },
  deleteMatches: deleteManualMatches,
  setVideoLink: setMatchesVideoLink,
  setMatchVideo: (_actor, id, video) => setLibraryMatchVideo(id, video),
  importEvent: async (_actor, { eventCode, seasonId }) => {
    try {
      const r = await importLibraryEvent(seasonId, eventCode);
      return { ok: true, summary: { eventCode, eventName: r.eventName, written: r.imported, skipped: r.skipped, skippedReason: "without posted scores", skippedManual: r.skippedManual } };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Couldn't import that event." };
    }
  },
  backfill: (actor) => backfillLibraryMetadata(actor),
  countCompletedSessions: countCompletedSessionsForMatch,
};

/** The seasons the library offers (the program's enabled games), the default one, and a name lookup that never throws for an id it does not know. */
export function useLibrarySeasons(): { seasons: { id: string; name: string }[]; defaultSeasonId: string; nameOf: (id: string) => string } {
  const data = useProgramData();
  return useMemo(() => {
    const seasons = (data ? data.games.seasons.filter((s) => s.enabled) : getEnabledSeasons()).map((s) => ({ id: s.id, name: s.name }));
    return { seasons, defaultSeasonId: data ? data.games.defaultSeasonId : DEFAULT_SEASON_ID, nameOf: (id: string) => seasons.find((s) => s.id === id)?.name ?? id };
  }, [data]);
}

/** The active program's library adapter. This is the one place the Match Library panel asks which program's data it has. */
export function useLibraryAdapter(): LibraryAdapter {
  return useProgramData()?.library ?? rootLibraryAdapter;
}
