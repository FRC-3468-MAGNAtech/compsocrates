import type { RegistryEntry } from "@/lib/deletion/registry";

/**
 * Person data that only this program's collections hold (account deletion, `lib/deletion/registry.ts`). Data only; paths are under `programs/ftc/`. Add a row here
 * when new code stores a person.
 */
const pair = (uid: string, name?: string) => ({ uid, name });

/** An imported row's id holds a slug of the scout's name (`csv_<team>_<event>_<match>_<robot>_<slug>-<hash>`); the slug is swapped for the replacement name's. */
const CSV_SLUG = /[^a-z0-9]+/g;
const slugOf = (text: string): string => text.toLowerCase().replace(CSV_SLUG, "-").replace(/^-+|-+$/g, "").slice(0, 24);
export function renameImportedRowId(id: string, name: string): string | null {
  const slug = slugOf(name);
  if (!id.startsWith("csv_") || slug === "") return null;
  const needle = `_${slug}-`;
  const at = id.lastIndexOf(needle);
  if (at === -1) return null;
  const replacement = `_${slugOf("Deleted Account")}-`;
  return `${id.slice(0, at)}${replacement}${id.slice(at + needle.length)}`;
}

export const FTC_DELETION_ENTRIES: readonly RegistryEntry[] = [
  {
    id: "scoutEntries", collection: "scoutEntries", action: "rewrite", fields: ["uid", "scoutName"],
    finders: [
      { kind: "equals", field: "uid" },
      { kind: "namesInTeams", nameField: "scoutName", uidFields: ["uid"], teamField: "teamId", idPrefix: "csv_" },
    ],
    rewrite: { pairs: [pair("uid", "scoutName")], keepNameForIdPrefix: ["csv_"] }, renameId: renameImportedRowId,
    note: "entries stay (team numbers and accuracy). Imported rows hold the IMPORTER's uid and the scout's name: the name is rewritten by a known-name match only, and the id is copied (it holds a slug of the name)",
  },
  {
    id: "joinRequests", collection: "teams/*/joinRequests", action: "delete", fields: ["uid", "name"], finders: [{ kind: "perTeamDoc", paths: ["joinRequests/{uid}"] }], note: "the person's own request documents (id = uid)",
  },
  { id: "joinRequestDecisions", collection: "teams/*/joinRequests", action: "rewrite", fields: ["decidedBy"], finders: [{ kind: "perTeamEquals", sub: "joinRequests", field: "decidedBy" }], rewrite: { pairs: [pair("decidedBy")] }, note: "requests this person (an admin) decided" },
  { id: "joinRequestPointers", collection: "joinRequestPointers", action: "delete", fields: ["entries[].teamId"], finders: [{ kind: "docId" }], note: "the server-only pending-join pointer, including its last-closed status entry (user private)" },
  {
    id: "assignments", collection: "assignments", action: "rewrite", fields: ["current.generatedBy", "previous.generatedBy", "current.settings.scoutUids", "current.counts", "current.slots[].scoutUid", "previous.settings.scoutUids", "previous.counts", "previous.slots[].scoutUid"],
    finders: [{ kind: "teamScan", teamField: "teamId" }],
    rewrite: {
      pairs: [pair("current.generatedBy"), pair("previous.generatedBy")],
      uidArrays: ["current.settings.scoutUids", "previous.settings.scoutUids"],
      mapKeys: ["current.counts", "previous.counts"],
      embedded: [
        { path: "current.slots", spec: { pairs: [pair("scoutUid")] } },
        { path: "previous.slots", spec: { pairs: [pair("scoutUid")] } },
      ],
    },
    note: "found by reading the team's assignment documents (uids inside slots cannot be queried); each published schedule keeps its slots under the opaque id",
  },
  { id: "formTemplates", collection: "formTemplates", action: "rewrite", fields: ["createdBy"], finders: [{ kind: "equals", field: "createdBy" }], rewrite: { pairs: [pair("createdBy")] }, note: "authorName is the team's label here, not a person: kept" },
  {
    id: "rateLimitsExtra", collection: "rateLimits", scope: "site", action: "delete", fields: ["key"],
    finders: [{ kind: "idPrefix", prefixes: ["ftc-field-teams_", "ftc-templates_", "ftcjoin_"] }], note: "this program's counters whose id embeds the uid",
  },
];
