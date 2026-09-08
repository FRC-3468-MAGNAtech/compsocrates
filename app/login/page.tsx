import Link from "next/link";
import { Zap } from "lucide-react";
import GlassCard from "../_components/GlassCard";
import { FormField } from "../_components/FormField";

export default function LoginPage() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <GlassCard strong accent="current" className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[var(--cs-current)]/15 text-[var(--cs-current)]">
            <Zap size={18} />
          </div>
          <h1 className="text-xl font-bold">Welcome back</h1>
        </div>
        <form className="flex flex-col gap-4">
          <FormField label="Email" />
          <FormField label="Password" />
          <button
            type="button"
            className="mt-2 rounded-xl bg-[var(--cs-current)] px-4 py-2.5 text-sm font-bold text-[#04231f] transition-transform hover:scale-[1.01]"
          >
            Log In
          </button>
        </form>
        <p className="mt-5 text-center text-sm text-[var(--cs-text-dim)]">
          Need an account?{" "}
          <Link href="/signup" className="font-semibold text-[var(--cs-volt)]">
            Sign up
          </Link>
        </p>
      </GlassCard>
    </div>
  );
}
