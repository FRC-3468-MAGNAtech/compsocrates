import type { Metadata } from "next";
import { CreditsView } from "@/components/credits/credits-view";

export const metadata: Metadata = { title: "Credits" };

// The public Credits page (signed-out visitors can open it; a signed-in visitor sees the same page under the same header). One component, shared
// with each program's in-app Credits route. `credits` is not in the app's redirect list (config/legacy-redirects.ts), so /credits stays here.
export default function PublicCreditsPage() {
  return (
    <div className="mx-auto w-full max-w-5xl py-10">
      <CreditsView />
    </div>
  );
}
