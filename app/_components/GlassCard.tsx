import { HTMLAttributes, ReactNode } from "react";

type GlassCardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  strong?: boolean;
  accent?: "volt" | "plasma" | "current" | "signal" | "amber" | "none";
  className?: string;
};

const accentRing: Record<string, string> = {
  volt: "hover:border-[var(--cs-volt)]/40 hover:shadow-[0_0_40px_-10px_var(--cs-volt)]",
  plasma: "hover:border-[var(--cs-plasma)]/40 hover:shadow-[0_0_40px_-10px_var(--cs-plasma)]",
  current: "hover:border-[var(--cs-current)]/40 hover:shadow-[0_0_40px_-10px_var(--cs-current)]",
  signal: "hover:border-[var(--cs-signal)]/40 hover:shadow-[0_0_40px_-10px_var(--cs-signal)]",
  amber: "hover:border-[var(--cs-amber)]/40 hover:shadow-[0_0_40px_-10px_var(--cs-amber)]",
  none: "",
};

export default function GlassCard({
  children,
  strong = false,
  accent = "none",
  className = "",
  ...rest
}: GlassCardProps) {
  return (
    <div
      className={`${strong ? "glass-strong" : "glass"} rounded-3xl p-5 transition-all duration-300 ${accentRing[accent]} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
