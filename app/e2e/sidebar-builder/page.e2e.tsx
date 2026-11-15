import { notFound } from "next/navigation";
import { SidebarBuilderFixture } from "./fixture";

// A test-only page for the Playwright suite (e2e/sidebar-builder.e2e.ts, Session F): the real Admin Panel > Sidebar screen (drag and drop builder, preview, sync card)
// on in-memory data, with no login and no Firestore. (What the database allows is proved by the emulator tests.) A 404 unless E2E_THEME_CHECK=1.
export const dynamic = "force-dynamic";

export default function SidebarBuilderFixturePage() {
  if (process.env.E2E_THEME_CHECK !== "1") notFound();
  return <SidebarBuilderFixture />;
}
