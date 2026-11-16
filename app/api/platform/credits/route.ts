import { ownerCredits, saveCredits } from "@/lib/server/platform-credits";
import { withOwner } from "@/lib/server/platform-route";
import { readJsonBody } from "@/lib/server/route-helpers";

/** The platform owner's credits: GET reads the stored document uncached (what the editor starts from); POST saves it with a version check, or resets it to the built-in list. */
export async function GET(request: Request) {
  return withOwner(request, {}, (db) => ownerCredits(db));
}

export async function POST(request: Request) {
  return withOwner(request, { rateLimit: { key: "platform-credits-write", limit: 120 } }, async (db, owner) => {
    const body = await readJsonBody(request);
    return saveCredits(db, owner, { sections: body.sections, expectedVersion: body.expectedVersion, reset: body.reset === true });
  });
}
