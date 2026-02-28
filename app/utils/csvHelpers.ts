export function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += ch;
  }

  values.push(current);
  return values.map((value) => value.trim());
}

export function splitCsvRecords(text: string): string[] {
  const records: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '""';
        i += 1;
      } else {
        inQuotes = !inQuotes;
        current += ch;
      }
      continue;
    }
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (current.trim()) records.push(current);
      current = "";
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      continue;
    }
    current += ch;
  }

  if (current.trim()) records.push(current);
  return records;
}

export function csvEscape(value: unknown): string {
  const raw = String(value ?? "");
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export function normalizeHeader(header: string): string {
  return String(header || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function toBoolean(value: unknown): boolean {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "y" || raw === "yes" || raw === "true" || raw === "1";
}

export function toNumber(value: unknown): number {
  const numeric = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}
