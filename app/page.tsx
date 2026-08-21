"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BarChart3, ClipboardList, Gauge, Radar, ShieldCheck, Target } from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import { getDashboardRoute } from "@/app/utils/dashboardRoute";
import { FloatingDeck, GreekHeader, GreekTechBackground, HudPill, PillButton, SectionShell, StatBadge } from "@/app/components/GreekTech";

const signalDecks = [
  { label: "Match Strategy", value: "Alliance", detail: "Head-to-head decks", icon: Target },
  { label: "Scout Accuracy", value: "Matrix", detail: "Practice verification", icon: ShieldCheck },
  { label: "Team Breakdown", value: "Trends", detail: "Radar profiles", icon: Radar },
  { label: "Pit Inputs", value: "Logs", detail: "Capability capture", icon: ClipboardList },
];

export default function LandingPage() {
  const router = useRouter();
  const { user, userData } = useAuth();
  const signedIn = Boolean(user && userData);
  const dashboardHref = userData ? getDashboardRoute(userData) : "/dashboard";

  return (
    <GreekTechBackground>
      <SectionShell className="min-h-screen">
        <HudPill className="mx-auto flex max-w-4xl items-center justify-between gap-3 p-2">
          <Link href="/" className="flex items-center gap-3 rounded-full border border-white/70 bg-white/35 py-1.5 pl-2 pr-4">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-red-800 via-red-600 to-amber-300 text-xs font-black text-white shadow-lg shadow-red-900/20">
              CS
            </div>
            <span className="font-display text-xl text-slate-950">CompSocrates</span>
          </Link>
          <div className="flex items-center gap-2">
            <PillButton variant="ghost" onClick={() => router.push("/login")}>
              Log In
            </PillButton>
            <PillButton onClick={() => router.push(signedIn ? dashboardHref : "/signup")}>
              {signedIn ? "Dashboard" : "Join Team"}
              <ArrowRight className="h-4 w-4" />
            </PillButton>
          </div>
        </HudPill>

        <main className="mt-10 grid gap-6 xl:grid-cols-[minmax(0,0.78fr)_minmax(28rem,1.22fr)]">
          <div className="space-y-6 xl:pt-12">
            <FloatingDeck priority="high" className="p-6 lg:p-8">
              <GreekHeader
                eyebrow="MAGNATech Light Strategy"
                title="CompSocrates"
                subtitle="A floating HUD for FRC scouting, verification, matchup planning, and pit intelligence."
                actions={
                  <>
                    <StatBadge icon={Gauge} label="Mode" value="Live" tone="gold" />
                    <StatBadge icon={BarChart3} label="Views" value="Strategy" tone="crimson" />
                  </>
                }
              />
              <div className="mt-8 flex flex-wrap gap-3">
                <PillButton onClick={() => router.push(signedIn ? dashboardHref : "/signup")}>
                  {signedIn ? "Open Command" : "Start Scouting"}
                  <ArrowRight className="h-4 w-4" />
                </PillButton>
                <PillButton variant="secondary" onClick={() => router.push("/login")}>
                  Team Access
                </PillButton>
              </div>
            </FloatingDeck>

            <FloatingDeck className="ml-auto max-w-md p-5 xl:translate-x-10" priority="critical">
              <p className="text-xs font-black uppercase tracking-[0.24em] text-red-900/60">Drive Coach Surface</p>
              <p className="mt-4 text-sm leading-6 text-slate-700">
                High-priority views surface matchup plans, scout trust, and robot trend signals before lower-priority tables.
              </p>
            </FloatingDeck>
          </div>

          <div className="grid gap-5 lg:grid-cols-[1fr_0.72fr]">
            <FloatingDeck priority="critical" className="min-h-[26rem] p-6 lg:row-span-2">
              <div className="flex items-start justify-between gap-5">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.28em] text-red-900/60">Primary Deck</p>
                  <h2 className="mt-3 font-display text-4xl text-slate-950">Alliance Matchup</h2>
                </div>
                <span className="rounded-full border border-amber-300/70 bg-white/35 px-4 py-2 font-mono text-sm font-black text-amber-950">
                  REBUILT
                </span>
              </div>

              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                {["Auto Fuel", "Cycle Pace", "Climb Value"].map((label, index) => (
                  <div key={label} className="rounded-[1.75rem] border border-white/70 bg-white/32 p-4 shadow-[0_12px_36px_rgba(15,23,42,0.08)] backdrop-blur-2xl">
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{label}</p>
                    <p className="mt-5 font-mono text-4xl font-black text-red-800">{[84, 91, 76][index]}</p>
                  </div>
                ))}
              </div>

              <div className="mt-8 grid gap-3">
                {signalDecks.slice(0, 3).map((deck, index) => {
                  const Icon = deck.icon;
                  return (
                    <div
                      key={deck.label}
                      className={`flex items-center gap-4 rounded-[1.75rem] border border-white/70 bg-white/28 p-4 backdrop-blur-2xl ${
                        index === 1 ? "ml-8" : index === 2 ? "mr-10" : ""
                      }`}
                    >
                      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-amber-100/60 text-red-900">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-black text-slate-950">{deck.label}</h3>
                        <p className="text-sm text-slate-600">{deck.detail}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </FloatingDeck>

            <FloatingDeck priority="high" className="self-start p-5 lg:translate-y-12">
              <p className="text-xs font-black uppercase tracking-[0.24em] text-amber-900/70">Verification</p>
              <h2 className="mt-3 font-display text-3xl text-slate-950">Scout Accuracy</h2>
              <p className="mt-4 text-sm leading-6 text-slate-700">Practice matrices turn scout reliability into a visible operating signal.</p>
            </FloatingDeck>

            <FloatingDeck className="self-end p-5 lg:-translate-x-8">
              <p className="text-xs font-black uppercase tracking-[0.24em] text-red-900/60">Inputs</p>
              <h2 className="mt-3 font-display text-3xl text-slate-950">Pit Logs</h2>
              <p className="mt-4 text-sm leading-6 text-slate-700">Form workflows stay intact while the command surface is rebuilt around faster decisions.</p>
            </FloatingDeck>
          </div>
        </main>
      </SectionShell>
    </GreekTechBackground>
  );
}
