import type { ButtonHTMLAttributes, ElementType, ReactNode } from "react";

/**
 * Floating-HUD primitive library. Every authenticated and public surface
 * composes from these — no page should hand-roll its own card/grid/nav
 * markup. Light-mode only: slate/pearl canvas, crimson + metallic gold,
 * extreme glass translucency, glossy top-edge sheen.
 */

export function HudCanvas({ children }: { children: ReactNode }) {
  return <div className="hud-canvas">{children}</div>;
}

export function HudViewport({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1720px] px-4 pb-10 pt-28 sm:px-6 lg:px-10 ${className}`}>{children}</div>;
}

/** The floating pill-shaped command bar — replaces a conventional top nav / sidebar. */
export function CommandBar({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`fixed inset-x-0 top-4 z-40 mx-auto flex w-fit max-w-[95vw] items-center gap-2 rounded-full border border-amber-300/40 bg-white/40 p-2 shadow-2xl shadow-red-900/10 backdrop-blur-xl ${className}`}
    >
      {children}
    </div>
  );
}

type SurfaceProps = { children: ReactNode; className?: string; raised?: boolean; interactive?: boolean };

/** Base glass surface: extreme translucency + glossy top-left sheen + gold/crimson edge tint. */
export function Surface({ children, className = "", raised = false, interactive = false }: SurfaceProps) {
  return (
    <div
      className={`rounded-[1.75rem] ${raised ? "glass-surface-raised" : "glass-surface"} ${
        interactive ? "transition-transform duration-300 hover:-translate-y-1 hover:glow-gold" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

/** An asymmetrically-placed floating panel — the building block of the strategy-deck layout paradigm. */
export function Deck({
  children,
  className = "",
  priority = "normal",
  offset = "",
}: SurfaceProps & { priority?: "normal" | "high" | "critical"; offset?: string }) {
  const priorityGlow = {
    normal: "shadow-[0_18px_70px_-16px_rgba(15,23,42,0.16)]",
    high: "shadow-[0_22px_90px_-16px_rgba(212,175,55,0.28)]",
    critical: "shadow-[0_22px_90px_-16px_rgba(139,0,0,0.26)]",
  }[priority];
  return (
    <Surface interactive className={`p-5 lg:p-6 ${priorityGlow} ${offset} ${className}`}>
      {children}
    </Surface>
  );
}

export function PageIntro({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-3xl">
        {eyebrow && <p className="mb-3 text-xs font-bold uppercase tracking-[0.32em] text-red-800/70">{eyebrow}</p>}
        <h1 className="font-display text-4xl text-slate-950 sm:text-5xl">{title}</h1>
        {subtitle && <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </header>
  );
}

const chipTone = {
  gold: "border-amber-300/60 bg-white/45 text-amber-950",
  crimson: "border-red-300/50 bg-white/45 text-red-950",
  slate: "border-white/70 bg-slate-50/50 text-slate-900",
};

export function Chip({
  label,
  value,
  tone = "slate",
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  tone?: keyof typeof chipTone;
  icon?: ElementType;
}) {
  return (
    <div className={`inline-flex items-center gap-2.5 rounded-full border px-4 py-2 shadow-sm backdrop-blur-xl ${chipTone[tone]}`}>
      {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
      <span className="text-[11px] font-bold uppercase tracking-[0.18em] opacity-70">{label}</span>
      <span className="font-data text-sm font-semibold">{value}</span>
    </div>
  );
}

type ActionProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" };

const actionVariants: Record<string, string> = {
  primary: "border-red-800/50 bg-gradient-to-br from-red-700 to-red-900 text-white shadow-[0_12px_42px_rgba(139,0,0,0.28)] hover:brightness-110",
  secondary: "border-amber-300/70 bg-white/45 text-amber-950 shadow-[0_8px_30px_rgba(212,175,55,0.16)] hover:bg-amber-50/70",
  ghost: "border-white/70 bg-white/35 text-slate-800 hover:bg-white/55",
  danger: "border-red-800/60 bg-red-800/90 text-white hover:bg-red-900",
};

export function Action({ children, variant = "primary", className = "", ...rest }: ActionProps) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-full border px-5 py-2.5 text-sm font-bold backdrop-blur-xl transition duration-200 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50 ${actionVariants[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function StatTile({ label, value, unit }: { label: string; value: ReactNode; unit?: string }) {
  return (
    <Surface className="p-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-3 font-data text-3xl font-black text-red-800">
        {value}
        {unit && <span className="ml-1 text-sm font-semibold text-slate-500">{unit}</span>}
      </p>
    </Surface>
  );
}
