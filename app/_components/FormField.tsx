import { ReactNode } from "react";

type FormFieldProps = {
  label: string;
  children?: ReactNode;
  hint?: string;
};

export function FormField({ label, children, hint }: FormFieldProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-[var(--cs-text-dim)]">{label}</span>
      {children ?? (
        <input
          disabled
          placeholder="—"
          className="w-full rounded-xl border border-[var(--cs-border)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--cs-text)] placeholder:text-[var(--cs-text-faint)] outline-none"
        />
      )}
      {hint && <span className="text-[11px] text-[var(--cs-text-faint)]">{hint}</span>}
    </label>
  );
}

export function FormSelect({ label, options }: { label: string; options: string[] }) {
  return (
    <FormField label={label}>
      <select
        disabled
        className="w-full rounded-xl border border-[var(--cs-border)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--cs-text)] outline-none"
      >
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </FormField>
  );
}

export function FormTextarea({ label }: { label: string }) {
  return (
    <FormField label={label}>
      <textarea
        disabled
        rows={4}
        placeholder="—"
        className="w-full rounded-xl border border-[var(--cs-border)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--cs-text)] placeholder:text-[var(--cs-text-faint)] outline-none"
      />
    </FormField>
  );
}
