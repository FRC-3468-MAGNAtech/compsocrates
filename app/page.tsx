"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Crosshair, Radar, ShieldCheck, Sparkles, Swords, Wrench } from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import { getDashboardRoute } from "@/app/utils/dashboardRoute";
import { Action, Chip, CommandBar, Deck, HudCanvas, HudViewport, PageIntro, Surface } from "@/app/components/Hud";

const capabilities = [
  { icon: Swords, title: "Alliance Matchup Decks", body: "Head-to-head comparison surfaces built for a 5-minute pre-match huddle." },
  { icon: ShieldCheck, title: "Scout Verification Matrix", body: "Practice entries cross-checked against ground truth before they ever reach strategy." },
  { icon: Radar, title: "Team Trend Radar", body: "Consistency curves and capability profiles at a glance, not buried in a spreadsheet." },
  { icon: Wrench, title: "Pit Capability Log", body: "Structured robot intake that feeds straight into matchup planning." },
];

export default function LandingPage() {
  const router = useRouter();
  const { user, userData } = useAuth();
  const signedIn = Boolean(user && userData);
  const dashboardHref = userData ? getDashboardRoute(userData) : "/dashboard";

  return (
    <HudCanvas>
      <CommandBar>
        <Link href="/" className="flex items-center gap-2 rounded-full py-1.5 pl-2 pr-4">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-red-800 via-red-600 to-amber-300 text-xs font-black text-white shadow-lg shadow-red-900/25">
            CS
          </span>
          <span className="font-display text-lg text-slate-950">CompSocrates</span>
        </Link>
        <Action variant="ghost" onClick={() => router.push("/login")}>
          Log In
        </Action>
        <Action onClick={() => router.push(signedIn ? dashboardHref : "/signup")}>
          {signedIn ? "Open HUD" : "Join a Team"}
          <ArrowUpRight className="h-4 w-4" />
        </Action>
      </CommandBar>

      <HudViewport>
        {/* Asymmetric hero — one dominant deck, two staggered satellites, deliberately not a symmetric row */}
        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <Deck priority="critical" className="xl:row-span-2">
            <p className="text-xs font-black uppercase tracking-[0.3em] text-red-900/60">Tactical Scouting HUD</p>
            <h1 className="mt-4 font-display text-5xl leading-[1.05] text-slate-950 sm:text-6xl">
              Field every <span className="gradient-text">advantage</span>
            </h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-slate-600">
              CompSocrates replaces the scouting binder with a floating command surface — live
              match data, verified scout accuracy, and alliance strategy in one glass HUD.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Action onClick={() => router.push(signedIn ? dashboardHref : "/signup")}>
                {signedIn ? "Open Command" : "Start Scouting"}
                <ArrowUpRight className="h-4 w-4" />
              </Action>
              <Action variant="secondary" onClick={() => router.push("/login")}>
                Team Access
              </Action>
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <Chip icon={Sparkles} label="Mode" value="Live" tone="gold" />
              <Chip icon={Crosshair} label="Focus" value="Alliance Strategy" tone="crimson" />
            </div>
          </Deck>

          <Deck priority="high" offset="lg:translate-x-6">
            <p className="text-xs font-black uppercase tracking-[0.28em] text-amber-900/70">Drive Coach View</p>
            <h2 className="mt-3 font-display text-3xl text-slate-950">Matchup, Ranked</h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              High-priority signals — matchup fit, scout trust, robot trend — surface before anything else.
            </p>
          </Deck>

          <Deck priority="normal" offset="lg:-translate-x-4 self-end">
            <p className="text-xs font-black uppercase tracking-[0.28em] text-red-900/60">Pit Intelligence</p>
            <h2 className="mt-3 font-display text-3xl text-slate-950">Capability Logs</h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              Structured robot intake feeds directly into alliance planning — no re-keying.
            </p>
          </Deck>
        </div>

        <div className="mt-16">
          <PageIntro eyebrow="Capabilities" title="Built for the huddle, not the spreadsheet" />
          <div className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {capabilities.map((cap, index) => {
              const Icon = cap.icon;
              return (
                <Surface
                  key={cap.title}
                  interactive
                  className={`p-5 ${index === 1 ? "sm:translate-y-4" : index === 3 ? "sm:-translate-y-4" : ""}`}
                >
                  <div className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-amber-100/80 to-white/40 text-red-800">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 font-display text-lg text-slate-950">{cap.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{cap.body}</p>
                </Surface>
              );
            })}
          </div>
        </div>

        <div className="mt-16">
          <Deck priority="high" className="text-center">
            <h2 className="font-display text-3xl text-slate-950">Bring your whole team onto one HUD</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-slate-600">
              Scouts, strategists, drive coaches, and judges — one dataset, one command surface.
            </p>
            <div className="mt-6 flex justify-center">
              <Action onClick={() => router.push("/signup")}>
                Create Your Team
                <ArrowUpRight className="h-4 w-4" />
              </Action>
            </div>
          </Deck>
        </div>

        <footer className="mt-16 flex flex-col items-center gap-2 text-center text-xs text-slate-500">
          <div className="flex gap-4">
            <Link href="/privacy-policy" className="hover:text-slate-800">
              Privacy Policy
            </Link>
            <Link href="/terms-of-service" className="hover:text-slate-800">
              Terms of Service
            </Link>
          </div>
          <p>© 2026 CompSocrates.</p>
        </footer>
      </HudViewport>
    </HudCanvas>
  );
}
