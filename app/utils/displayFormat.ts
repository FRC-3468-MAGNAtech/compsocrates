export function toTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function formatAnalyticsText(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "-";
  const normalized = raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return toTitleCase(normalized);
}
