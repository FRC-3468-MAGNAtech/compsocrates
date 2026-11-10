"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc, updateDoc } from "firebase/firestore";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import type { FtcEvent } from "@/lib/ftc/types";
import type { ActiveEventsState } from "@/lib/active-events";
import type { CsSubmissionControls, CsTeamDoc, SubmissionLockout } from "@/data/cs/types";
import { csTeamToTeamDoc, selectedEventsPatch } from "@/data/cs/teams";
import type { FieldTeam } from "@/lib/field-teams";

export type TeamDoc = {
  /** Legacy single FTC team number. Since P19 it mirrors the first entry of `fieldTeams` (still read as a fallback until the migration has run). Prefer useFieldTeams() (lib/field-teams-context.tsx). */
  number: number;
  name: string | null;
  /** P19: the account's FTC teams, in the admin's order. Absent on accounts the migration hasn't reached; `readFieldTeams()` (lib/field-teams.ts) falls back to `number`/`name`. */
  fieldTeams?: FieldTeam[];
  /** P19: ids of `fieldTeams`, same order. A rules-only mirror (firestore.rules can't project a list of maps) that member `fieldTeamIds` writes are checked against. */
  fieldTeamIdList?: string[];
  /** P21: which form each season uses (`{ [seasonId]: formId }`), set by an admin. Absent = every season uses its own default (the built-in). See lib/forms/resolve.ts `activeFormIdFor`. */
  activeForms?: Record<string, string>;
  /** P19/P20: the numbers of `fieldTeams`, same order: a queryable mirror (Firestore can't query inside a list of maps) so an application can check whether an account already has an FTC team. */
  fieldTeamNumbers?: number[];
  /** P20: the TEAM owner's uid: authoritative for ownership. Server-written only (rules refuse it from any client). See lib/team-owner.ts. */
  ownerUid?: string;
  /** P20: a pending ownership transfer (see `readPendingTransfer`/`livePendingTransfer` in lib/team-owner.ts). Server-written only; expires after 7 days. */
  pendingTransfer?: unknown;
  /** P19: optional display name for the account itself (e.g. the robotics organisation), separate from the FTC teams. */
  accountName?: string | null;
  joinCode: string;
  activeEventCode: string | null;
  activeSeasonId: number | null;
  // Denormalized copy of the active event's own details, so every page
  // reading "what's the active event" doesn't need a second FIRST API round
  // trip just to show its name/dates — refreshed whenever an admin sets a
  // new one (see setActiveEvent below).
  activeEvent: FtcEvent | null;
  /**
   * FIX1: the team can have several active events at once. `activeEventCode`/
   * `activeSeasonId`/`activeEvent` above stay as the **primary** event so
   * pre-FIX1 readers keep working; these two hold the full selection (always
   * including the primary). Optional — absent on teams created before FIX1,
   * which `readActiveEvents()` (lib/active-events.ts) reads as a one-event list.
   */
  activeEventCodes?: string[];
  /** Denormalized copies of every active event, same reason as `activeEvent`. */
  activeEvents?: FtcEvent[];
  /** D1: CS's `selectedEvents` (TBA keys): the SINGLE source of truth for the active events. `activeEvents` and friends above are derived from it on read. */
  selectedEvents?: string[];
  /** D1: CS `submissionControls` as stored. Use `submissionLockout` to gate a new submission. */
  submissionControls?: CsSubmissionControls;
  /** D1: the lockout CS's `assertSubmissionsOpen` enforces on every NEW submission (edit mode bypasses it). */
  submissionLockout?: SubmissionLockout;
  /** D1: CS `eventAttendees` ({ eventKey: (uid | name)[] }), passed through untouched. */
  eventAttendees?: Record<string, string[]>;
  /** D1: CS `manualTeamListsByEvent`, passed through untouched. */
  manualTeamListsByEvent?: Record<string, unknown>;
  /** D1: CS `formAccessOverrides` ({ formKey: uid[] }), passed through untouched. */
  formAccessOverrides?: Record<string, string[]>;
  /** D1: CS `timeOverride`, passed through untouched. */
  timeOverride?: NonNullable<CsTeamDoc["timeOverride"]>;
  /** P3: admin-set in Match Library. Optional — absent on teams created before this field existed, treat as `false`. */
  usePlaceholderVideo?: boolean;
  /** P14: set (in the same transaction that creates them) once the starter changelog drafts have been seeded, so they're never recreated after an admin deletes them. */
  changelogSeeded?: boolean;
  /** P15: set once this team's admin has stamped the pre-P15 library docs with `origin`/`published` (lib/library/store.ts backfillLibraryMetadata), so it isn't re-run on every login. */
  libraryBackfilled?: boolean;
};

/**
 * Realtime subscription to the *caller's own* team doc — `teamId` comes
 * from their profile (`useAuth().profile?.teamId`), not a fixed id (see
 * docs/ASSUMPTIONS.md, P1b: team docs now get an auto-generated id, created
 * via /api/team/create, since more than one can exist). Pass `null` while
 * the caller's profile hasn't loaded yet, or isn't on a team at all.
 */
export function useTeamDoc(teamId: string | null) {
  const [team, setTeam] = useState<TeamDoc | null>(null);
  // isFirebaseConfigured() is a pure, static check — folding it into the
  // initializer (rather than setting it from inside the effect below) means
  // the "not configured" case never needs a synchronous setState in an effect.
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) {
      // Deliberate: resets to "no team" whenever teamId becomes unavailable
      // (profile not loaded yet, or this user isn't on a team), rather than
      // leaving a previous team's data on screen.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTeam(null);
      setLoaded(true);
      return;
    }
    const unsubscribe = onSnapshot(
      doc(db, "teams", teamId),
      (snap) => {
        setTeam(snap.exists() ? csTeamToTeamDoc(snap.id, snap.data() as CsTeamDoc) : null);
        setLoaded(true);
      },
      (err) => {
        console.error("teams/{teamId} subscription failed:", err);
        setTeam(null);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [teamId]);

  return { team, loaded };
}

/**
 * FIX1 / D1: writes the multi-event selection to CS's `selectedEvents` (TBA keys, primary first, de-duplicated, max 10) with a merge
 * write, and to nothing else: `selectedEvents` is the single source of truth, every other team field is left untouched. Admin-gated at
 * the call site (Event Selection page) via usePermissions(); also enforced in firestore.rules.
 */
export async function setActiveEvents(teamId: string, state: ActiveEventsState) {
  await setDoc(doc(db, "teams", teamId), selectedEventsPatch(state), { merge: true });
}

/** Single-event convenience over setActiveEvents() — replaces the whole selection with this one event (or clears it). */
export async function setActiveEvent(teamId: string, event: FtcEvent | null) {
  await setActiveEvents(teamId, event ? { events: [event], primaryCode: event.code } : { events: [], primaryCode: null });
}

/** Admin-gated at the call site (Admin Panel > Match Library) via usePermissions(); also enforced in firestore.rules. */
export async function setUsePlaceholderVideo(teamId: string, value: boolean) {
  await updateDoc(doc(db, "teams", teamId), { usePlaceholderVideo: value });
}
