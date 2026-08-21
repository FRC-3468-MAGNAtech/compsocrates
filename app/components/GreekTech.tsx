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
  gold: "border-amber-300/50 bg-white/40 text-amber-950 shadow-[0_8px_32px_rgba(212,175,55,0.15)] backdrop-blur-2xl",
  crimson: "border-red-300/45 bg-white/40 text-red-950 shadow-[0_8px_32px_rgba(220,38,38,0.12)] backdrop-blur-2xl",
  slate: "border-white/70 bg-slate-50/45 text-slate-900 shadow-[0_8px_32px_rgba(15,23,42,0.08)] backdrop-blur-2xl",
};

export function GreekTechBackground({ children }: { children: ReactNode }) {
  return (
    <div className="greek-tech-bg min-h-screen text-slate-950">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-28 top-10 h-[30rem] w-[30rem] rounded-full bg-red-500/15 blur-3xl" />
        <div className="absolute right-[-6rem] top-1/4 h-[34rem] w-[34rem] rounded-full bg-amber-400/20 blur-3xl" />
        <div className="absolute bottom-[-8rem] left-1/4 h-[28rem] w-[28rem] rounded-full bg-red-700/10 blur-3xl" />
        <div className="absolute bottom-20 right-1/3 h-72 w-72 rounded-full bg-amber-200/20 blur-3xl" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/90 to-transparent" />
      </div>
      <div className="relative z-10">{children}</div>
    </div>
  );
}

export function GlassCard({ children, className = "", hover = true }: GlassCardProps) {
  return (
    <section
      className={`glass-card rounded-[2rem] border border-white/65 border-b-amber-500/20 border-r-red-500/20 border-l-white/80 border-t-white/80 bg-white/40 shadow-[0_24px_90px_rgba(139,0,0,0.12)] backdrop-blur-2xl ${
        hover ? "transition duration-300 hover:-translate-y-1 hover:shadow-[0_28px_100px_rgba(212,175,55,0.18)]" : ""
      } ${className}`}
    >
      {children}
    </section>
  );
}

export function GradientBorder({ children, className = "" }: GlassCardProps) {
  return (
    <div className={`rounded-[2rem] bg-gradient-to-br from-white/90 via-amber-300/65 to-red-500/45 p-px shadow-[0_18px_70px_rgba(212,175,55,0.14)] ${className}`}>
      <div className="h-full rounded-[calc(2rem-1px)] bg-white/38 backdrop-blur-2xl">{children}</div>
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
    primary: "border-red-700/60 bg-red-700/90 text-white shadow-[0_12px_42px_rgba(139,0,0,0.22)] hover:bg-red-800",
    secondary: "border-amber-300/70 bg-white/40 text-amber-950 shadow-[0_8px_30px_rgba(212,175,55,0.12)] hover:bg-amber-100/70",
    ghost: "border-white/70 bg-white/35 text-slate-800 shadow-[0_8px_28px_rgba(15,23,42,0.08)] hover:bg-white/60",
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
  return <div className={`mx-auto w-full max-w-[1680px] px-4 pb-8 pt-24 sm:px-6 lg:px-8 ${className}`}>{children}</div>;
}

export function FloatingDeck({
  children,
  className = "",
  priority = "normal",
}: GlassCardProps & { priority?: "normal" | "high" | "critical" }) {
  const priorityClass = {
    normal: "shadow-[0_18px_70px_rgba(15,23,42,0.10)]",
    high: "shadow-[0_22px_90px_rgba(212,175,55,0.18)]",
    critical: "shadow-[0_22px_90px_rgba(220,38,38,0.16)]",
  };

  return (
    <div
      className={`glass-card rounded-[2rem] border border-white/70 border-b-amber-500/20 border-r-red-500/20 bg-slate-50/45 p-5 backdrop-blur-2xl transition duration-300 hover:-translate-y-1 ${priorityClass[priority]} ${className}`}
    >
      {children}
    </div>
  );
}

export function HudPill({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-full border border-amber-300/40 bg-white/40 shadow-2xl shadow-red-900/10 backdrop-blur-xl ${className}`}>
      {children}
    </div>
  );
}
