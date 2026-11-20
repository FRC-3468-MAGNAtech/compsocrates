import { handleSnapshot } from "@/lib/server/snapshot-route";

// Snapshot routes (read reduction 2a): a shared, cached read of a read-mostly team dataset. All logic is in lib/server/snapshot-route.ts.
export const maxDuration = 30;

export async function GET(request: Request, context: { params: Promise<{ dataset: string }> }) {
  const { dataset } = await context.params;
  return handleSnapshot(request, dataset);
}
