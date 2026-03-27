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

export type MatchLabelCategory = "practice" | "qualification" | "quarterfinals" | "semifinals" | "finals" | "unknown";

export function getMatchLabelMeta(rawMatch: string): {
  shortLabel: string;
  category: MatchLabelCategory;
  order: number;
  matchNumber: number;
} {
  const rawValue = String(rawMatch || "").trim();
  if (!rawValue) {
    return { shortLabel: "-", category: "unknown", order: 99, matchNumber: 0 };
  }
  let value = rawValue;
  if (value.includes("_")) {
    const suffix = value.split("_").pop() || "";
    if (suffix && /[a-z]/i.test(suffix)) {
      value = suffix;
    }
  }
  const lower = value.toLowerCase();
  const compact = lower.replace(/[^a-z0-9]/g, "");
  const explicitMatchNumber =
    lower.match(/\b(?:match|mtch|matc?h|march|marltch)\s*#?\s*(\d+)\b/)?.[1] ||
    lower.match(/\bm\s*#?\s*(\d+)\b/)?.[1];
  const roundThenMatchNumber = lower.match(/\bround\s*\d+\D+(\d+)\b/)?.[1];
  const allNumbers = lower.match(/\d+/g) || [];
  const matchNumberFromLabel =
    explicitMatchNumber ||
    roundThenMatchNumber ||
    (allNumbers.length > 1 && lower.includes("round") ? allNumbers[allNumbers.length - 1] : undefined) ||
    lower.match(/\d+/)?.[0] ||
    "1";
  const number = matchNumberFromLabel.replace(/^0+/, "") || "1";
  const matchNumber = Number(number) || 0;

  const isQuarter =
    lower.includes("quarter") ||
    lower.startsWith("qf") ||
    /\bqf\b/.test(lower) ||
    compact.startsWith("qf");
  const isSemi =
    lower.includes("semi") ||
    lower.startsWith("sf") ||
    /\bsf\b/.test(lower) ||
    compact.startsWith("sf");
  const isPractice =
    lower.includes("practice") ||
    lower.startsWith("p") ||
    compact.startsWith("practice");
  const isQualification =
    lower.startsWith("q") ||
    lower.includes("qual") ||
    /\bqm\b/.test(lower) ||
    compact.startsWith("qual");
  const isFinals =
    lower.startsWith("f") ||
    lower.includes("final") ||
    lower.includes("playoff") ||
    lower.includes("elim") ||
    /\bf\b/.test(lower) ||
    compact.startsWith("final");
  const isGenericMatch = /^\s*match\b/.test(lower) || compact.startsWith("match");

  let category: MatchLabelCategory = "unknown";
  if (isPractice) category = "practice";
  else if (isQualification) category = "qualification";
  else if (isQuarter) category = "quarterfinals";
  else if (isSemi) category = "semifinals";
  else if (isFinals) category = "finals";
  else if (isGenericMatch) category = "semifinals";

  const orderMap: Record<MatchLabelCategory, number> = {
    practice: 0,
    qualification: 1,
    quarterfinals: 2,
    semifinals: 3,
    finals: 4,
    unknown: 99,
  };
  const prefixMap: Record<MatchLabelCategory, string> = {
    practice: "P",
    qualification: "Q",
    quarterfinals: "QF",
    semifinals: "SF",
    finals: "F",
    unknown: "",
  };
  const prefix = prefixMap[category] || "";
  const shortLabel = prefix ? `${prefix}${number}` : value;
  return {
    shortLabel,
    category,
    order: orderMap[category] ?? 99,
    matchNumber,
  };
}

export function formatMatchLabelShort(rawMatch: string): string {
  return getMatchLabelMeta(rawMatch).shortLabel || "-";
}

export function formatMatchLabelLong(rawMatch: string): string {
  const rawValue = String(rawMatch || "").trim();
  if (!rawValue) return "-";
  const meta = getMatchLabelMeta(rawValue);
  const labelMap: Record<MatchLabelCategory, string> = {
    practice: "Practice",
    qualification: "Qualification",
    quarterfinals: "Quarterfinal",
    semifinals: "Semi-Final",
    finals: "Final",
    unknown: "Match",
  };
  const baseLabel = labelMap[meta.category] || "Match";
  if (meta.category === "unknown") return rawValue;
  const matchNumber = meta.matchNumber || Number(rawValue.replace(/\D/g, "")) || 0;
  return matchNumber > 0 ? `${baseLabel} ${matchNumber}` : baseLabel;
}
