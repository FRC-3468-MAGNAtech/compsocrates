/**
 * Starting or joining a team in the FTC program: the documents a person writes. No React, no Firebase (the writes are in `write.ts`).
 *
 * - A team is `programs/ftc/teams/{CODE}`: the document id IS the random join code, never the team number (a number-based id could equal
 *   an id in a root collection and expose FTC presence documents through root collection-group queries). Codes here are 8 characters,
 *   longer than the root program's 6, which keeps the two id spaces apart.
 *   It carries the sister app's schema (`fieldTeams`, `fieldTeamIdList`, `fieldTeamNumbers`, `ownerUid`, `joinCode`, empty active events),
 *   plus an optional `location`.
 * - The creator's membership profile is `programs/ftc/users/{uid}`: team admin and owner, on the account's first team.
 * - A request to join is `programs/ftc/teams/{CODE}/joinRequests/{uid}` (the sister app joins instantly through a server route and has no
 *   request document; this is new, additive schema).
 */
import { DEFAULT_ROLE_ID } from "@/lib/roles";
import { defaultThemeId } from "@/lib/themes";
import { generateTeamCode } from "@/data/cs/join-requests";
import { migratedFieldTeamId } from "@/data/ftc/teams";

/** FTC join codes are 8 characters (the root program's are 6), from the same unambiguous alphabet. */
export const FTC_JOIN_CODE_LENGTH = 8;


/** One new random join code (also the new team's document id). `random` is injectable for tests. */
export function newFtcJoinCode(random: () => number = Math.random): string {
  return generateTeamCode(random, FTC_JOIN_CODE_LENGTH);
}


export type NewTeamInput = {
  uid: string;
  email: string;
  /** The creator's display name. */
  name: string;
  teamNumber: number;
  teamName: string;
  location: string;
};

/** The team document and the creator's profile, to be written in one batch. `createdAt` is a server timestamp the caller supplies. */
export function ftcNewTeamDocs(code: string, input: NewTeamInput, createdAt: unknown): { team: Record<string, unknown>; user: Record<string, unknown> } {
  const teamName = input.teamName.trim();
  const location = input.location.trim();
  const first = { id: migratedFieldTeamId(input.teamNumber), number: input.teamNumber, name: teamName };
  return {
    team: {
      number: input.teamNumber,
      name: teamName || null,
      fieldTeams: [first],
      fieldTeamIdList: [first.id],
      fieldTeamNumbers: [input.teamNumber],
      ...(location ? { location } : {}),
      ownerUid: input.uid,
      joinCode: code,
      activeEventCode: null,
      activeSeasonId: null,
      activeEvent: null,
      activeEventCodes: [],
      activeEvents: [],
      createdAt,
    },
    user: {
      name: input.name.trim(),
      email: input.email,
      teamId: code,
      primaryRole: DEFAULT_ROLE_ID,
      secondaryRoles: [],
      isAdmin: true,
      isOwner: true,
      fieldTeamIds: [first.id],
      themeId: defaultThemeId,
      createdAt,
    },
  };
}

export type JoinRequestInput = { uid: string; name: string };

/** `programs/ftc/teams/{code}/joinRequests/{uid}`. The document id is the applicant's uid, so one person has at most one pending request per team. */
export function ftcJoinRequestDoc(input: JoinRequestInput, createdAt: unknown): Record<string, unknown> {
  return { uid: input.uid, name: input.name.trim(), status: "pending", createdAt };
}
