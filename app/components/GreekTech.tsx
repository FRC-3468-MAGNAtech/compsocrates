import type { ElementType, ReactNode } from "react";

type GlassCardProps = {
  children: ReactNode;
  className?: string;
  hover?: boolean;
};

type StatBadgeProps = {
  label: string;
  value: ReactNode;
  tone?: "gold" | "crimson" | "slate";
  icon?: ElementType;
};

type GreekHeaderProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
};

const toneClasses = {
  gold: "border-amber-300/40 bg-amber-50/80 text-amber-900",
  crimson: "border-red-300/35 bg-red-50/80 text-red-900",
  slate: "border-slate-300/50 bg-white/75 text-slate-800",
};

export function GreekTechBackground({ children }: { children: ReactNode }) {
  return (
    <div className="greek-tech-bg min-h-screen text-slate-950">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-20 top-16 h-72 w-72 rounded-full bg-red-500/10 blur-3xl" />
        <div className="absolute right-0 top-1/4 h-80 w-80 rounded-full bg-amber-300/18 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-red-700/8 blur-3xl" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-300/70 to-transparent" />
      </div>
      <div className="relative z-10">{children}</div>
    </div>
  );
}

export function GlassCard({ children, className = "", hover = true }: GlassCardProps) {
  return (
    <section
      className={`glass-card rounded-3xl border border-white/70 bg-white/72 shadow-[0_24px_80px_rgba(139,0,0,0.09)] backdrop-blur-xl ${
        hover ? "transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_28px_90px_rgba(139,0,0,0.14)]" : ""
      } ${className}`}
    >
      {children}
    </section>
  );
}

export function GradientBorder({ children, className = "" }: GlassCardProps) {
  return (
    <div className={`rounded-3xl bg-gradient-to-br from-amber-300/55 via-white/70 to-red-500/35 p-px ${className}`}>
      <div className="h-full rounded-[calc(1.5rem-1px)] bg-white/76 backdrop-blur-xl">{children}</div>
    </div>
  );
}

export function GreekHeader({ eyebrow, title, subtitle, actions }: GreekHeaderProps) {
  return (
    <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-3xl">
        {eyebrow && (
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.32em] text-red-800/70">
            {eyebrow}
          </p>
        )}
        <h1 className="font-display text-4xl text-slate-950 sm:text-5xl">{title}</h1>
        {subtitle && <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </header>
  );
}

export function StatBadge({ label, value, tone = "slate", icon: Icon }: StatBadgeProps) {
  return (
    <div className={`inline-flex items-center gap-3 rounded-full border px-4 py-2 shadow-sm ${toneClasses[tone]}`}>
      {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
      <span className="text-xs font-bold uppercase tracking-[0.18em] opacity-70">{label}</span>
      <span className="font-mono text-sm font-semibold">{value}</span>
    </div>
  );
}

export function PillButton({
  children,
  className = "",
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  const variants = {
    primary: "border-red-700 bg-red-700 text-white shadow-lg shadow-red-900/18 hover:bg-red-800",
    secondary: "border-amber-300/70 bg-amber-100/80 text-amber-950 hover:bg-amber-200/80",
    ghost: "border-slate-200/80 bg-white/65 text-slate-700 hover:bg-white",
  };
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition duration-200 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-55 ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function SectionShell({ children, className = "" }: GlassCardProps) {
  return <div className={`mx-auto w-full max-w-[1560px] px-4 py-6 sm:px-6 lg:px-8 ${className}`}>{children}</div>;
}
