"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BarChart3, ClipboardList, Gauge, ShieldCheck, Target } from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import { getDashboardRoute } from "@/app/utils/dashboardRoute";
import { GlassCard, GreekHeader, GreekTechBackground, PillButton, SectionShell, StatBadge } from "@/app/components/GreekTech";

const platformSignals = [
  { label: "Match Intel", value: "Live", icon: ClipboardList },
  { label: "Strategy Views", value: "15", icon: BarChart3 },
  { label: "Scout Review", value: "Verified", icon: ShieldCheck },
];

const capabilityCards = [
  {
    title: "Scout Capture",
    body: "Role-aware forms for match, pit, drive, helper, team strategy, and match strategy workflows.",
    icon: ClipboardList,
  },
  {
    title: "Event Command",
    body: "Assignments, match lists, event details, people management, and team operations share one navigation model.",
    icon: Gauge,
  },
  {
    title: "Competitive Analysis",
    body: "Analytics screens keep the preview-branch scoring logic and move it into a brighter strategy workspace.",
    icon: Target,
  },
];

export default function LandingPage() {
  const router = useRouter();
  const { user, userData } = useAuth();
  const signedIn = Boolean(user && userData);
  const dashboardHref = userData ? getDashboardRoute(userData) : "/dashboard";

  return (
    <GreekTechBackground>
      <SectionShell className="flex min-h-screen flex-col">
        <nav className="mb-10 flex items-center justify-between rounded-full border border-white/70 bg-white/72 px-4 py-3 shadow-xl shadow-red-900/5 backdrop-blur-xl">
          <Link href="/" className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-red-800 via-red-600 to-amber-300 text-sm font-black text-white shadow-lg shadow-red-900/20">
              CS
            </div>
            <span className="font-display text-2xl text-slate-950">CompSocrates</span>
          </Link>
          <div className="flex items-center gap-2">
            {signedIn ? (
              <PillButton onClick={() => router.push(dashboardHref)}>
                Dashboard
                <ArrowRight className="h-4 w-4" />
              </PillButton>
            ) : (
              <>
                <PillButton variant="ghost" onClick={() => router.push("/login")}>
                  Log In
                </PillButton>
                <PillButton onClick={() => router.push("/signup")}>
                  Join Team
                  <ArrowRight className="h-4 w-4" />
                </PillButton>
              </>
            )}
          </div>
        </nav>

        <main className="grid flex-1 items-center gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(25rem,1.1fr)]">
          <div className="space-y-8">
            <GreekHeader
              eyebrow="MAGNATech Strategy Platform"
              title="CompSocrates"
              subtitle="A bright Greek-Tech command center for FRC scouting, match planning, and event intelligence."
              actions={platformSignals.map((signal) => (
                <StatBadge key={signal.label} icon={signal.icon} label={signal.label} value={signal.value} tone="gold" />
              ))}
            />

            <div className="flex flex-wrap gap-3">
              <PillButton onClick={() => router.push(signedIn ? dashboardHref : "/signup")}>
                {signedIn ? "Open Dashboard" : "Start Scouting"}
                <ArrowRight className="h-4 w-4" />
              </PillButton>
              <PillButton variant="secondary" onClick={() => router.push("/login")}>
                Team Access
              </PillButton>
            </div>
          </div>

          <GlassCard className="p-5" hover={false}>
            <div className="relative overflow-hidden rounded-[1.6rem] border border-amber-200/50 bg-gradient-to-br from-white via-amber-50/70 to-red-50/60 p-5">
              <div className="absolute right-6 top-6 h-24 w-24 rounded-full border border-amber-300/50" />
              <div className="absolute right-14 top-14 h-36 w-36 rounded-full border border-red-200/50" />
              <div className="relative grid gap-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.28em] text-red-900/60">Current Focus</p>
                    <h2 className="mt-2 font-display text-3xl text-slate-950">Alliance Readiness</h2>
                  </div>
                  <div className="rounded-full border border-amber-300/60 bg-white/76 px-4 py-2 font-mono text-sm font-bold text-amber-900">
                    REBUILT
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  {["Auto Fuel", "Cycle Pace", "Climb Value"].map((label, index) => (
                    <div key={label} className="rounded-3xl border border-white/70 bg-white/70 p-4 shadow-sm backdrop-blur">
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{label}</p>
                      <p className="mt-3 font-mono text-3xl font-black text-red-800">{[84, 91, 76][index]}</p>
                    </div>
                  ))}
                </div>

                <div className="grid gap-3">
                  {capabilityCards.map((card) => {
                    const Icon = card.icon;
                    return (
                      <div key={card.title} className="flex gap-4 rounded-3xl border border-amber-200/40 bg-white/72 p-4 shadow-sm backdrop-blur">
                        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-red-50 text-red-800">
                          <Icon className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="font-bold text-slate-950">{card.title}</h3>
                          <p className="mt-1 text-sm leading-6 text-slate-600">{card.body}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </GlassCard>
        </main>
      </SectionShell>
    </GreekTechBackground>
  );
}
