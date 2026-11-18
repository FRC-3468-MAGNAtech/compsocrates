import type { RegistryEntry, RewriteSpec } from "@/lib/deletion/registry";

/**
 * Person data that only this program's collections hold (account deletion, `lib/deletion/registry.ts`). Data only. Collections are the root ones live CS also writes:
 * the field names come from the app's writers and from the CS reference code (`scoutId`, `scoutName`, `userId`, ...). Add a row here when new code stores a person.
 */
const pair = (uid: string, name?: string) => ({ uid, name });
const spec = (...pairs: { uid: string; name?: string }[]): RewriteSpec => ({ pairs });
const names = (nameField: string, ...uidFields: string[]) => ({ kind: "namesInTeams" as const, nameField, uidFields, teamField: "teamId" });

export const FRC_DELETION_ENTRIES: readonly RegistryEntry[] = [
  {
    id: "scouting", collection: "scouting", action: "rewrite", fields: ["scoutId", "scoutName", "manualFlaggedBy"],
    finders: [{ kind: "equals", field: "scoutId" }, { kind: "equals", field: "manualFlaggedBy" }, names("scoutName", "scoutId")], rewrite: spec(pair("scoutId", "scoutName"), pair("manualFlaggedBy")),
    note: "match entries stay (team numbers and accuracy); old rows with no scoutId are matched by a known name only",
  },
  { id: "leadScouting", collection: "leadScouting", action: "rewrite", fields: ["scoutId", "submittedBy", "scoutName"], finders: [{ kind: "equals", field: "scoutId" }, { kind: "equals", field: "submittedBy" }, names("scoutName", "scoutId", "submittedBy")], rewrite: spec(pair("scoutId", "scoutName"), pair("submittedBy")), note: "lead scouting forms" },
  { id: "pitScouting", collection: "pitScouting", action: "rewrite", fields: ["scoutId", "submittedBy", "scoutName"], finders: [{ kind: "equals", field: "scoutId" }, { kind: "equals", field: "submittedBy" }, names("scoutName", "scoutId", "submittedBy")], rewrite: spec(pair("scoutId", "scoutName"), pair("submittedBy")), note: "pit forms" },
  { id: "strategyScouting", collection: "strategyScouting", action: "rewrite", fields: ["scoutId", "scoutName"], finders: [{ kind: "equals", field: "scoutId" }, names("scoutName", "scoutId")], rewrite: spec(pair("scoutId", "scoutName")), note: "strategy forms" },
  { id: "matchStrategyPlans", collection: "matchStrategyPlans", action: "rewrite", fields: ["scoutId", "scoutName"], finders: [{ kind: "equals", field: "scoutId" }], rewrite: spec(pair("scoutId", "scoutName")), note: "match strategy forms" },
  { id: "driveScouting", collection: "driveScouting", action: "rewrite", fields: ["scoutId", "scoutName"], finders: [{ kind: "equals", field: "scoutId" }], rewrite: spec(pair("scoutId", "scoutName")), note: "drive team forms" },
  { id: "helperReports", collection: "helperReports", action: "rewrite", fields: ["helperId", "helperName", "scoutName"], finders: [{ kind: "equals", field: "helperId" }], rewrite: spec(pair("helperId", "helperName")), note: "helper forms (a scoutName beside helperName is not rewritten: unverified, see the results file)" },
  ...(["matchAssignments", "pitAssignments", "teamAssignments", "practiceAssignments"] as const).map(
    (collection): RegistryEntry => ({
      id: collection, collection, action: "rewrite", fields: ["scoutId", "scoutName", "assignedBy"],
      finders: [{ kind: "equals", field: "scoutId" }, { kind: "equals", field: "assignedBy" }], rewrite: spec(pair("scoutId", "scoutName"), pair("assignedBy")),
      note: "assignment rows stay so the schedule history is intact",
    }),
  ),
  { id: "accuracyRescouts", collection: "accuracyRescouts", action: "rewrite", fields: ["scoutId", "scoutName"], finders: [{ kind: "equals", field: "scoutId" }], rewrite: spec(pair("scoutId", "scoutName")), note: "the scout being rescouted (other uid fields written by callers are unverified)" },
  { id: "scoutingFlagStates", collection: "scoutingFlagStates", action: "rewrite", fields: ["dismissedBy"], finders: [{ kind: "equals", field: "dismissedBy" }], rewrite: spec(pair("dismissedBy")), note: "who dismissed a flag" },
  { id: "teamAnnouncements", collection: "teamAnnouncements", action: "rewrite", fields: ["authorId", "authorName"], finders: [{ kind: "equals", field: "authorId" }], rewrite: spec(pair("authorId", "authorName")), note: "announcements stay with the team" },
  { id: "subInRequests", collection: "subInRequests", action: "rewrite", fields: ["requestedById", "requestedByName", "claimedById", "claimedByName"], finders: [{ kind: "equals", field: "requestedById" }, { kind: "equals", field: "claimedById" }], rewrite: spec(pair("requestedById", "requestedByName"), pair("claimedById", "claimedByName")), note: "sub-in requests" },
  { id: "judgeBookCards", collection: "judgeBookCards", action: "rewrite", fields: ["createdByUid", "createdByName", "updatedByUid", "updatedByName"], finders: [{ kind: "equals", field: "createdByUid" }, { kind: "equals", field: "updatedByUid" }], rewrite: spec(pair("createdByUid", "createdByName"), pair("updatedByUid", "updatedByName")), note: "older top-level cards (the live copy is inside the team document)" },
  { id: "versionReleases", collection: "versionReleases", action: "rewrite", fields: ["authorUid", "authorName"], finders: [{ kind: "equals", field: "authorUid" }], rewrite: spec(pair("authorUid", "authorName")), note: "older top-level release notes (the live copy is inside the team document)" },
  { id: "teamTransfers", collection: "teamTransfers", action: "rewrite", fields: ["fromUid", "fromName", "toUid", "toName"], finders: [{ kind: "equals", field: "fromUid" }, { kind: "equals", field: "toUid" }], rewrite: spec(pair("fromUid", "fromName"), pair("toUid", "toName")), note: "ownership transfers" },
  { id: "scoutTargets", collection: "scoutTargets", action: "rewrite", fields: ["updatedBy", "individual", "extraScouts"], finders: [{ kind: "equals", field: "updatedBy" }], rewrite: spec(pair("updatedBy")), note: "updatedBy only; the per-scout keys inside `individual` and `extraScouts` are unverified (owner decision, see the results file)" },
  {
    id: "teamJoinRequests", collection: "teamJoinRequests", action: "delete", fields: ["userId", "userName", "userEmail", "userEmailLower", "userRole"],
    finders: [{ kind: "equals", field: "userId" }, { kind: "equalsKnown", field: "userEmailLower", known: "emailLower" }], note: "join requests, including old ones that have an email and no userId",
  },
  { id: "joinRequestDecisions", collection: "teamJoinRequests", action: "rewrite", fields: ["processedBy"], finders: [{ kind: "equals", field: "processedBy" }], rewrite: spec(pair("processedBy")), note: "requests this person (an admin) decided" },
  { id: "formTemplates", collection: "formTemplates", action: "rewrite", fields: ["createdBy", "authorName"], finders: [{ kind: "equals", field: "createdBy" }], rewrite: spec(pair("createdBy", "authorName")), note: "templates stay; the author's name is a profile name here" },
];
