import { describe, expect, it } from "vitest";
import { buildBlobPath } from "@/lib/blob/paths";
import { authorizeBlobUpload, blobUserFromAppDoc, parseClientPayload, type BlobAuthDeps, type BlobUserDoc } from "@/lib/server/blob-auth";

// Form photos for a program with its own namespace: the upload names the program, and the server decides from that program's own profile and page access.

const TEAM = "ftcteam1";
const RANDOM = "0123456789abcdef0123456789abcdef";
const loc = { kind: "pit", teamId: TEAM, eventCode: "USTXAUS1", teamNumber: "4242" };
const payload = (over: Record<string, unknown> = {}) => JSON.stringify({ formId: "pit-scout-v1", ...loc, ...over });

describe("the upload payload's program", () => {
  it("is kept when it names a program with its own namespace, and absent otherwise", () => {
    expect(parseClientPayload(payload({ program: "ftc" }))?.program).toBe("ftc");
    expect(parseClientPayload(payload())).not.toHaveProperty("program");
    // the default program's payload is what it always was
    expect(parseClientPayload(payload({ program: "frc" }))).not.toHaveProperty("program");
    // anything else is ignored rather than trusted
    expect(parseClientPayload(payload({ program: "nope" }))).not.toHaveProperty("program");
    expect(parseClientPayload(payload({ program: 5 }))).not.toHaveProperty("program");
  });
});

describe("blobUserFromAppDoc (a user doc with the app's own field names)", () => {
  it("reads the team, roles and flags; only an exact true is admin or owner", () => {
    expect(blobUserFromAppDoc({ teamId: TEAM, primaryRole: "pit-scout", secondaryRoles: ["lead-scout", "wizard", 3], isAdmin: true, isOwner: false })).toEqual({
      teamId: TEAM,
      primaryRole: "pit-scout",
      secondaryRoles: ["lead-scout"],
      isAdmin: true,
      isOwner: false,
    });
    expect(blobUserFromAppDoc({ teamId: TEAM, isAdmin: "yes", isOwner: 1 })).toMatchObject({ isAdmin: false, isOwner: false });
  });

  it("a doc with nothing usable is a team-less match scout, never an admin", () => {
    const user = blobUserFromAppDoc({});
    expect(user).toMatchObject({ teamId: "", primaryRole: "match-scout", secondaryRoles: [], isAdmin: false, isOwner: false });
  });
});

describe("authorizing a photo for a program-namespaced account", () => {
  const deps = (users: Record<string, BlobUserDoc>): BlobAuthDeps => ({ getUser: async (uid) => users[uid] ?? null, getPageAccessConfig: async () => null });
  const run = async (uid: string, users: Record<string, BlobUserDoc>, program = "ftc") =>
    authorizeBlobUpload({ uid, pathname: await buildBlobPath({ ...loc, uid, random: RANDOM }), clientPayload: payload({ program }), deps: deps(users) });

  it("lets the account's pit scout upload for the pit form (the page defaults allow pit scouts), and carries the program in the token", async () => {
    const users = { u1: blobUserFromAppDoc({ teamId: TEAM, primaryRole: "pit-scout", secondaryRoles: [] }) };
    const r = await run("u1", users);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) throw new Error("unreachable");
    expect(JSON.parse(r.tokenPayload)).toMatchObject({ uid: "u1", teamId: TEAM, program: "ftc" });
  });

  it("refuses a member whose role does not open the pit form, someone on another team, and an account with no profile there", async () => {
    expect(await run("u1", { u1: blobUserFromAppDoc({ teamId: TEAM, primaryRole: "match-scout" }) })).toMatchObject({ ok: false, code: "no-page-access" });
    expect(await run("u1", { u1: blobUserFromAppDoc({ teamId: "other", primaryRole: "pit-scout" }) })).toMatchObject({ ok: false, code: "wrong-team" });
    expect(await run("ghost", {})).toMatchObject({ ok: false, code: "unknown-user" });
  });

  it("an admin may upload for any form", async () => {
    expect(await run("u1", { u1: blobUserFromAppDoc({ teamId: TEAM, primaryRole: "match-scout", isAdmin: true }) })).toMatchObject({ ok: true });
  });
});
