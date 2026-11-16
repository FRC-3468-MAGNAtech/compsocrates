import { applyWrite, listFeed } from "@/lib/server/platform-changelog";
import { fail, withOwner, withViewer } from "@/lib/server/platform-route";
import { readJsonBody } from "@/lib/server/route-helpers";

/**
 * The platform changelog (Session 7). GET: the feed for any signed-in account (published entries; the platform owner also gets drafts with
 * `?drafts=1`). POST: the platform owner's writes `{ action: "create" | "update" | "publish" | "unpublish" | "delete", ... }`. Admin SDK only.
 */
export async function GET(request: Request) {
  const wantDrafts = new URL(request.url).searchParams.get("drafts") === "1";
  return withViewer(request, (db, viewer) => listFeed(db, viewer, wantDrafts));
}

export async function POST(request: Request) {
  return withOwner(request, { rateLimit: { key: "platform-changelog-write", limit: 120 } }, async (db, owner) => {
    const body = await readJsonBody(request);
    switch (body.action) {
      case "create":
        return applyWrite(db, owner, { kind: "create", input: body.entry, status: body.status === "published" ? "published" : "draft" });
      case "update":
        return applyWrite(db, owner, { kind: "update", id: body.id, input: body.entry, expectedRev: body.expectedRev, times: body.times, recordEdit: body.recordEdit, dateUnlocked: body.dateUnlocked, status: body.status === "published" ? "published" : body.status === "draft" ? "draft" : undefined });
      case "publish":
      case "unpublish":
        return applyWrite(db, owner, { kind: "status", id: body.id, expectedRev: body.expectedRev, status: body.action === "publish" ? "published" : "draft" });
      case "delete":
        return applyWrite(db, owner, { kind: "delete", id: body.id, expectedRev: body.expectedRev });
      default:
        return fail(400, "invalid_input", "Unknown action.");
    }
  });
}
