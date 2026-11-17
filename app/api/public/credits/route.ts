import { publicCredits } from "@/lib/server/platform-credits";
import { withPublicDb } from "@/lib/server/platform-route";

/** The public Credits read (Session 7): no sign-in needed, cached for a short time. `credits: null` means none were saved: the page shows its built-in list. */
export async function GET() {
  return withPublicDb((db) => publicCredits(db));
}
