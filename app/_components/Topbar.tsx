import { Bell, Search, ChevronDown } from "lucide-react";

export default function Topbar() {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-[var(--cs-border)] bg-black/30 px-6 py-3 backdrop-blur-xl">
      <div className="flex max-w-md flex-1 items-center gap-2 rounded-xl border border-[var(--cs-border)] bg-white/[0.03] px-3 py-2">
        <Search size={15} className="text-[var(--cs-text-faint)]" />
        <input
          disabled
          placeholder="Search teams, matches, scouts…"
          className="w-full bg-transparent text-sm text-[var(--cs-text)] placeholder:text-[var(--cs-text-faint)] outline-none"
        />
      </div>
      <div className="flex items-center gap-3">
        <button className="relative rounded-xl border border-[var(--cs-border)] bg-white/[0.03] p-2 text-[var(--cs-text-dim)] transition-colors hover:text-[var(--cs-volt)]">
          <Bell size={16} />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[var(--cs-plasma)]" />
        </button>
        <div className="flex items-center gap-2 rounded-xl border border-[var(--cs-border)] bg-white/[0.03] px-2.5 py-1.5">
          <div className="h-6 w-6 rounded-full bg-gradient-to-br from-[var(--cs-volt)] to-[var(--cs-current)]" />
          <span className="text-sm font-medium text-[var(--cs-text)]">Scout</span>
          <ChevronDown size={14} className="text-[var(--cs-text-faint)]" />
        </div>
      </div>
    </header>
  );
}
