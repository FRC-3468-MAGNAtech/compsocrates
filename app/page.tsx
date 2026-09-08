import Link from "next/link";
import { ArrowRight, Radar, Swords, BarChart3, Zap } from "lucide-react";
import GlassCard from "./_components/GlassCard";

export default function HomePage() {
  return (
    <div className="relative -mt-6 min-h-[calc(100vh-6rem)]">
      <div className="pointer-events-none absolute -top-10 right-0 h-96 w-96 rounded-full bg-[var(--cs-volt)] glow-orb animate-float-slow" />
      <div className="pointer-events-none absolute top-64 left-0 h-80 w-80 rounded-full bg-[var(--cs-plasma)] glow-orb animate-float-slow" style={{ animationDelay: "1.5s" }} />
      <div className="pointer-events-none absolute bottom-0 right-1/3 h-72 w-72 rounded-full bg-[var(--cs-signal)] glow-orb animate-float-slow" style={{ animationDelay: "3s" }} />

      <section className="relative z-10 flex flex-col items-start gap-6 py-16 sm:py-24">
        <div className="flex items-center gap-2 rounded-full border border-[var(--cs-border-strong)] bg-white/[0.04] px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-[var(--cs-volt)]">
          <Zap size={12} /> Season 2026 · Scouting Reimagined
        </div>
        <h1 className="max-w-3xl text-5xl font-extrabold leading-[1.05] tracking-tight sm:text-7xl">
          Scout sharper.
          <br />
          <span className="text-gradient-volt">Strategize faster.</span>
        </h1>
        <p className="max-w-xl text-base text-[var(--cs-text-dim)] sm:text-lg">
          CompSocrates unifies match scouting, pit intel, and drive-team reflection into one
          live command center — built for FRC teams who make decisions between matches, not after.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/signup"
            className="flex items-center gap-2 rounded-2xl bg-[var(--cs-volt)] px-6 py-3 text-sm font-bold text-[#06210a] transition-transform hover:scale-[1.03]"
          >
            Get Started <ArrowRight size={16} />
          </Link>
          <Link
            href="/login"
            className="glass rounded-2xl px-6 py-3 text-sm font-semibold text-[var(--cs-text)] transition-colors hover:border-[var(--cs-border-strong)]"
          >
            Log In
          </Link>
        </div>
      </section>

      <section className="relative z-10 grid gap-5 pb-20 sm:grid-cols-3">
        <GlassCard accent="volt" className="sm:translate-y-4">
          <Swords size={22} className="mb-3 text-[var(--cs-volt)]" />
          <h3 className="mb-1 text-lg font-bold">Live Match Scouting</h3>
          <p className="text-sm text-[var(--cs-text-dim)]">
            Fast-entry forms tuned for real-time capture, cycle counting, and endgame states.
          </p>
        </GlassCard>
        <GlassCard accent="current">
          <Radar size={22} className="mb-3 text-[var(--cs-current)]" />
          <h3 className="mb-1 text-lg font-bold">Robot Radar &amp; Rankings</h3>
          <p className="text-sm text-[var(--cs-text-dim)]">
            Auto-generated pick lists, reliability scores, and multi-axis team comparisons.
          </p>
        </GlassCard>
        <GlassCard accent="plasma" className="sm:translate-y-4">
          <BarChart3 size={22} className="mb-3 text-[var(--cs-plasma)]" />
          <h3 className="mb-1 text-lg font-bold">Role-Aware Dashboards</h3>
          <p className="text-sm text-[var(--cs-text-dim)]">
            Nine distinct views — from Drive Team to Judge/Awards — each surfacing what matters.
          </p>
        </GlassCard>
      </section>
    </div>
  );
}
