import { beforeEach, describe, expect, it } from "vitest";
import { FakeFirestore } from "@/lib/server/test-support/fake-firestore";
import { handleFtcTemplates } from "@/lib/ftc/server-templates";
import { buildTemplateContent } from "@/lib/templates/build";
import { SAMPLE_FORM } from "@/lib/forms/test-fixtures";

// A fake Admin Firestore: no network, no emulator. The token check is in app/api/ftc/templates/route.test.ts.
let fake: FakeFirestore;
const db = () => fake.asFirestore();
const admin = { uid: "admin-1" };
const body = (over: Record<string, unknown> = {}) => ({ program: "ftc", action: "import", teamId: "T1", id: "tpl1", ...over });

const built = buildTemplateContent({ form: SAMPLE_FORM, name: "Our template", description: "d", tags: ["x"] });
if (!built.ok) throw new Error("fixture template must build");
const content = built.content;

beforeEach(() => {
  fake = new FakeFirestore();
  fake.seed("programs/ftc/users/admin-1", { teamId: "T1", isAdmin: true, isOwner: false });
  fake.seed("programs/ftc/users/owner-1", { teamId: "T1", isAdmin: true, isOwner: true });
  fake.seed("programs/ftc/users/member-1", { teamId: "T1", isAdmin: false, isOwner: false });
  fake.seed("programs/ftc/users/other-admin", { teamId: "T2", isAdmin: true });
  fake.seed("programs/ftc/formTemplates/tpl1", { ...content, ownerTeamId: "T1", authorName: "Alpha", visibility: "private", official: false, version: 1, importCount: 0, reportCount: 0 });
  fake.seed("programs/ftc/formTemplates/theirs", { ...content, ownerTeamId: "T2", authorName: "Other", visibility: "public", official: false, version: 1, importCount: 0, reportCount: 0 });
});

describe("who may ask", () => {
  it("refuses a plain member, an admin of another team, an unknown caller and a team that is not the caller's", async () => {
    expect((await handleFtcTemplates(db(), { uid: "member-1" }, body())).status).toBe(403);
    expect((await handleFtcTemplates(db(), { uid: "other-admin" }, body())).status).toBe(403);
    expect((await handleFtcTemplates(db(), { uid: "nobody" }, body())).status).toBe(403);
    expect((await handleFtcTemplates(db(), admin, body({ teamId: "T2" }))).status).toBe(403);
  });
  it("accepts an admin and an owner", async () => {
    expect((await handleFtcTemplates(db(), admin, body())).status).toBe(200);
    expect((await handleFtcTemplates(db(), { uid: "owner-1" }, body())).status).toBe(200);
  });
});

describe("input", () => {
  it("requires the program in the body and refuses the other program and anything unknown", async () => {
    expect((await handleFtcTemplates(db(), admin, body({ program: undefined }))).body).toMatchObject({ code: "invalid_program" });
    expect((await handleFtcTemplates(db(), admin, body({ program: "frc" }))).body).toMatchObject({ code: "program_not_supported" });
    expect((await handleFtcTemplates(db(), admin, body({ program: "xyz" }))).body).toMatchObject({ code: "invalid_program" });
    expect((await handleFtcTemplates(db(), admin, body({ program: 7 }))).status).toBe(400);
  });
  it("rejects a bad action, team id and template id", async () => {
    expect((await handleFtcTemplates(db(), admin, body({ action: "approve" }))).body).toMatchObject({ code: "invalid_action" });
    expect((await handleFtcTemplates(db(), admin, body({ teamId: "../x" }))).body).toMatchObject({ code: "invalid_team" });
    expect((await handleFtcTemplates(db(), admin, body({ teamId: undefined }))).status).toBe(400);
    expect((await handleFtcTemplates(db(), admin, body({ id: "a/b" }))).body).toMatchObject({ code: "invalid_template" });
    expect((await handleFtcTemplates(db(), admin, body({ id: "" }))).status).toBe(400);
  });
});

describe("import", () => {
  it("returns the team's own template for the caller to copy, with nothing written", async () => {
    const before = JSON.stringify(fake.read("programs/ftc/formTemplates/tpl1"));
    const res = await handleFtcTemplates(db(), admin, body());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, template: { id: "tpl1", name: "Our template", version: 1, checksum: content.checksum } });
    expect(JSON.stringify(fake.read("programs/ftc/formTemplates/tpl1"))).toBe(before);
    expect(fake.ids("formTemplates")).toEqual([]); // no root document
  });

  it("refuses another team's template, even a public one (there is no cross-team sharing here), and a template that does not exist", async () => {
    expect((await handleFtcTemplates(db(), admin, body({ id: "theirs" }))).status).toBe(403);
    expect((await handleFtcTemplates(db(), admin, body({ id: "missing" }))).status).toBe(404);
  });

  it("refuses a template whose stored form no longer matches its checksum", async () => {
    fake.seed("programs/ftc/formTemplates/tpl1", { ...content, checksum: "0".repeat(16), ownerTeamId: "T1", visibility: "private", version: 1 });
    expect((await handleFtcTemplates(db(), admin, body())).body).toMatchObject({ ok: false, code: "damaged" });
  });
});
