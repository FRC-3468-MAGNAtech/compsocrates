import Link from "next/link";
import { Zap } from "lucide-react";
import GlassCard from "../_components/GlassCard";
import { FormField, FormSelect } from "../_components/FormField";

export default function SignupPage() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <GlassCard strong accent="volt" className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[var(--cs-volt)]/15 text-[var(--cs-volt)]">
            <Zap size={18} />
          </div>
          <h1 className="text-xl font-bold">Create your account</h1>
        </div>
        <form className="flex flex-col gap-4">
          <FormField label="Full Name" />
          <FormField label="Email" />
          <FormField label="Password" />
          <FormSelect label="Role" options={["Match Scout", "Pit Scout", "Lead Scout", "Team Coach", "Media"]} />
          <FormField label="Team Number" />
          <button
            type="button"
            className="mt-2 rounded-xl bg-[var(--cs-volt)] px-4 py-2.5 text-sm font-bold text-[#06210a] transition-transform hover:scale-[1.01]"
          >
            Sign Up
          </button>
        </form>
        <p className="mt-5 text-center text-sm text-[var(--cs-text-dim)]">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-[var(--cs-current)]">
            Log in
          </Link>
        </p>
      </GlassCard>
    </div>
  );
}
