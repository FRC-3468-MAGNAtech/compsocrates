import Link from "@/components/program/link";
import { GlassPanel } from "@/components/ui/glass-panel";

export type LegalSection = { heading: string; body: string };

/** A static legal page (Privacy Policy, Terms of Service) in the marketing shell: title, last-updated date, headed sections, and a link to its sibling. */
export function LegalPage({
  title,
  updatedOn,
  sections,
  otherHref,
  otherLabel,
}: {
  title: string;
  updatedOn: string;
  sections: LegalSection[];
  otherHref: string;
  otherLabel: string;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl py-10">
      <GlassPanel strong className="flex flex-col gap-6">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">Last updated: {updatedOn}</p>
        </header>
        {sections.map((section) => (
          <section key={section.heading} className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold">{section.heading}</h2>
            <p className="leading-7 text-[var(--foreground)]">{section.body}</p>
          </section>
        ))}
        <Link href={otherHref} className="inline-flex min-h-11 items-center self-start text-sm text-[var(--muted-foreground)] underline underline-offset-4 hover:text-[var(--foreground)]">
          {otherLabel}
        </Link>
      </GlassPanel>
    </div>
  );
}
