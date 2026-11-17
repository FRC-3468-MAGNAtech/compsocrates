import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The Firestore template service follows the program: the default program reads public, own and review-queue templates from the root `formTemplates` and calls
// `/api/templates` exactly as before; a program without cross-team sharing reads only its own account's templates from its own path and applies one through
// its own route (program and team in the body). Everything outside the service (auth, team doc, Firestore, fetch) is mocked.
const h = vi.hoisted(() => ({ program: "frc" as "frc" | "ftc", sharing: true, paths: [] as string[], adds: [] as string[], api: [] as { path: string; body: unknown }[], audits: [] as unknown[][], owner: false }));

vi.mock("@/lib/firebase/client", () => ({ db: {}, isFirebaseConfigured: () => true }));
vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join("/") }),
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join("/") }),
  where: (field: string, _op: string, value: unknown) => ({ field, value }),
  // the service builds its queries while rendering, so the paths it will read are visible without a DOM
  query: (ref: { path: string }, ...wheres: { field: string; value: unknown }[]) => {
    h.paths.push(`${ref.path}?${wheres.map((w) => `${w.field}=${String(w.value)}`).join("&")}`);
    return { path: ref.path, wheres };
  },
  onSnapshot: () => () => {},
  addDoc: async (ref: { path: string }) => {
    h.adds.push(ref.path);
    return { id: "new1" };
  },
  getDoc: async () => ({ exists: () => false }),
  getDocs: async () => ({ docs: [] }),
  updateDoc: async () => {},
  deleteDoc: async () => {},
  deleteField: () => null,
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { uid: "u1" }, profile: { teamId: "T1", name: "Sam", isPlatformOwner: h.owner } }) }));
vi.mock("@/lib/team", () => ({ useTeamDoc: () => ({ team: { accountName: "Alpha" } }) }));
vi.mock("@/lib/program/context", () => ({ useProgram: () => h.program, useProgramConfig: () => ({ admin: { templateSharing: h.sharing } }) }));
vi.mock("@/lib/api-client", () => ({
  authedApi: async (path: string, init: { body: unknown }) => {
    h.api.push({ path, body: init.body });
    return { template: { id: "tpl1", name: "T", version: 1 } };
  },
}));
vi.mock("@/lib/audit-log", () => ({ logAuditEvent: async (...args: unknown[]) => void h.audits.push(args) }));

import { TemplatesProvider } from "@/lib/templates/firestore-service";
import { useTemplates, type TemplateService } from "@/lib/templates/service";
import { SAMPLE_FORM } from "@/lib/forms/test-fixtures";

async function service(): Promise<TemplateService> {
  let svc: TemplateService | null = null;
  function Probe() {
    svc = useTemplates();
    return null;
  }
  renderToString(
    <TemplatesProvider>
      <Probe />
    </TemplatesProvider>
  );
  return svc as unknown as TemplateService;
}

beforeEach(() => {
  h.paths.length = 0;
  h.adds.length = 0;
  h.api.length = 0;
  h.audits.length = 0;
  h.owner = false;
});

describe("the default program (unchanged)", () => {
  it("reads the root collection (public and its own), applies through /api/templates with the body as before, and audits at the root", async () => {
    h.program = "frc";
    h.sharing = true;
    const svc = await service();
    expect(svc.sharing).toBe(true);
    expect(h.paths).toEqual(["formTemplates?visibility=public", "formTemplates?ownerTeamId=T1"]);
    await svc.use("tpl1");
    expect(h.api).toEqual([{ path: "/api/templates", body: { action: "import", id: "tpl1" } }]);
    await svc.create({ form: SAMPLE_FORM, name: "N", description: "", tags: [] });
    expect(h.adds).toEqual(["formTemplates"]);
    expect(h.audits.every((a) => a[7] === "frc")).toBe(true);
  });

  it("the platform owner also reads the review queue", async () => {
    h.program = "frc";
    h.sharing = true;
    h.owner = true;
    await service();
    expect(h.paths).toContain("formTemplates?visibility=public-pending");
  });
});

describe("a program with no cross-team sharing", () => {
  it("reads only its own account's templates from its own path (no public list, no review queue), even for a platform owner", async () => {
    h.program = "ftc";
    h.sharing = false;
    h.owner = true;
    const svc = await service();
    expect(svc.sharing).toBe(false);
    expect(h.paths).toEqual(["programs/ftc/formTemplates?ownerTeamId=T1"]);
  });

  it("creates under its own path, applies through its own route with program and team in the body, and audits under the program", async () => {
    h.program = "ftc";
    h.sharing = false;
    const svc = await service();
    await svc.create({ form: SAMPLE_FORM, name: "N", description: "", tags: [] });
    expect(h.adds).toEqual(["programs/ftc/formTemplates"]);
    await svc.use("tpl1");
    expect(h.api).toEqual([{ path: "/api/ftc/templates", body: { action: "import", id: "tpl1", program: "ftc", teamId: "T1" } }]);
    expect(h.audits.every((a) => a[7] === "ftc")).toBe(true);
  });

  it("publishing, reports and review are not available (and never reach the server)", async () => {
    h.program = "ftc";
    h.sharing = false;
    const svc = await service();
    await expect(svc.requestPublish("tpl1")).rejects.toThrow("isn't available");
    await expect(svc.report("tpl1", "x")).rejects.toThrow("isn't available");
    await expect(svc.approve("tpl1")).rejects.toThrow("isn't available");
    expect(h.api).toEqual([]);
  });
});
