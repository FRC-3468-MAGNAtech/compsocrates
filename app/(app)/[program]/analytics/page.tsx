import { redirect } from "next/navigation";

export default async function AnalyticsIndexPage({ params }: { params: Promise<{ program: string }> }) {
  const { program } = await params;
  redirect(`/${program}/analytics/match-scout`);
}
