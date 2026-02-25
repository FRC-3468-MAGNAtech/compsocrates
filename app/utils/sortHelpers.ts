export type SortDir = "asc" | "desc";

export function toSortValue(value: unknown): string | number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (Array.isArray(value)) return value.map((item) => String(item ?? "").toLowerCase()).join(", ");
  const raw = String(value ?? "").trim();
  const asNumber = raw === "" ? NaN : Number(raw);
  if (Number.isFinite(asNumber)) return asNumber;
  return raw.toLowerCase();
}

export function compareSortValues(a: unknown, b: unknown, dir: SortDir): number {
  const av = toSortValue(a);
  const bv = toSortValue(b);
  if (typeof av === "number" && typeof bv === "number") {
    return dir === "asc" ? av - bv : bv - av;
  }
  const as = String(av);
  const bs = String(bv);
  if (as < bs) return dir === "asc" ? -1 : 1;
  if (as > bs) return dir === "asc" ? 1 : -1;
  return 0;
}

export function sortLabel(currentKey: string, currentDir: SortDir, key: string, label: string) {
  if (currentKey !== key) return `${label} ↕`;
  return currentDir === "asc" ? `${label} ↑` : `${label} ↓`;
}

type MatchSortKey = {
  priority: number;
  setNumber: number;
  matchNumber: number;
};

export function parseMatchLabelForSort(label: string): MatchSortKey {
  const normalized = String(label || "").trim().toUpperCase().replace(/\s+/g, "");
  let prefix = "";
  if (normalized.startsWith("QF")) prefix = "QF";
  else if (normalized.startsWith("SF")) prefix = "SF";
  else if (normalized.startsWith("P")) prefix = "P";
  else if (normalized.startsWith("Q")) prefix = "Q";
  else if (normalized.startsWith("F")) prefix = "F";

  const priorityMap: Record<string, number> = {
    P: 0,
    Q: 1,
    QF: 2,
    SF: 3,
    F: 4,
  };
  const priority = priorityMap[prefix] ?? 9;
  const rest = normalized.slice(prefix.length);
  let setNumber = 0;
  let matchNumber = 0;
  if (rest.includes("M")) {
    const [setRaw, matchRaw] = rest.split("M");
    setNumber = Number(setRaw || 0) || 0;
    matchNumber = Number(matchRaw || 0) || 0;
  } else {
    matchNumber = Number(rest || 0) || 0;
  }
  return { priority, setNumber, matchNumber };
}

export function compareMatchLabels(aLabel: string, bLabel: string, dir: SortDir): number {
  const aKey = parseMatchLabelForSort(aLabel);
  const bKey = parseMatchLabelForSort(bLabel);
  if (aKey.priority !== bKey.priority) {
    return dir === "asc" ? aKey.priority - bKey.priority : bKey.priority - aKey.priority;
  }
  if (aKey.setNumber !== bKey.setNumber) {
    return dir === "asc" ? aKey.setNumber - bKey.setNumber : bKey.setNumber - aKey.setNumber;
  }
  return dir === "asc" ? aKey.matchNumber - bKey.matchNumber : bKey.matchNumber - aKey.matchNumber;
}
