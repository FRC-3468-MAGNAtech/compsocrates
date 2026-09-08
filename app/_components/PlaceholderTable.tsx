import GlassCard from "./GlassCard";

type PlaceholderTableProps = {
  columns: string[];
  rows?: number;
};

export default function PlaceholderTable({ columns, rows = 5 }: PlaceholderTableProps) {
  return (
    <GlassCard strong className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--cs-border)] bg-white/[0.03]">
              {columns.map((col) => (
                <th
                  key={col}
                  className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--cs-current)]"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, r) => (
              <tr key={r} className="border-b border-[var(--cs-border)]/60 last:border-0 hover:bg-white/[0.03]">
                {columns.map((col, c) => (
                  <td key={col + c} className="px-4 py-3 text-[var(--cs-text-dim)]">
                    {r === 0 && c === 0 ? "—" : "···"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
}
