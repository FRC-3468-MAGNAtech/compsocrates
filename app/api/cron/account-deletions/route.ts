import { cronRoute } from "@/lib/server/account-deletion/wire";

/**
 * Resumes every open account deletion within one shared budget. Send `Authorization: Bearer <CRON_SECRET>`. Vercel's Hobby plan runs a cron once a day at an inexact
 * time (`vercel.json`); a stalled job waits for the owner's Resume button; an external scheduler may call this more often.
 */
export const maxDuration = 30;

export async function GET(request: Request) {
  return cronRoute(request);
}
