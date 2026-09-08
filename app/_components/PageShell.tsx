import { ReactNode } from "react";

type PageShellProps = {
  title: string;
  eyebrow?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
};

export default function PageShell({ title, eyebrow, description, actions, children }: PageShellProps) {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute -top-24 right-10 h-72 w-72 rounded-full bg-[var(--cs-signal)] glow-orb animate-float-slow" />
      <div className="pointer-events-none absolute top-40 -left-16 h-64 w-64 rounded-full bg-[var(--cs-volt)] glow-orb animate-float-slow" style={{ animationDelay: "2s" }} />
      <div className="pointer-events-none absolute top-10 left-1/3 h-56 w-56 rounded-full bg-[var(--cs-plasma)] glow-orb animate-float-slower" style={{ animationDelay: "1s" }} />

      <div className="relative z-10 mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          {eyebrow && (
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--cs-current)]">
              {eyebrow}
            </p>
          )}
          <h1 className="text-3xl font-bold tracking-tight text-[var(--cs-text)] sm:text-4xl">{title}</h1>
          {description && <p className="mt-2 max-w-2xl text-sm text-[var(--cs-text-dim)]">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-3">{actions}</div>}
      </div>

      <div className="relative z-10">{children}</div>
    </div>
  );
}
