export type TeamTimeOverride = {
  enabled: boolean;
  offsetMs: number;
  updatedAt?: number;
  updatedBy?: string;
};

export function parseTeamTimeOverride(teamData?: Record<string, unknown> | null): TeamTimeOverride | null {
  if (!teamData) return null;
  const raw = teamData.timeOverride as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") return null;
  const enabled = Boolean(raw.enabled);
  const offsetMs = Number(raw.offsetMs || 0);
  return {
    enabled,
    offsetMs: Number.isFinite(offsetMs) ? offsetMs : 0,
    updatedAt: Number(raw.updatedAt || 0) || undefined,
    updatedBy: typeof raw.updatedBy === "string" ? raw.updatedBy : undefined,
  };
}

export function getEffectiveNowMs(override?: TeamTimeOverride | null): number {
  const offset = override?.enabled ? Number(override.offsetMs || 0) : 0;
  return Date.now() + (Number.isFinite(offset) ? offset : 0);
}

export function getEffectiveNowSec(override?: TeamTimeOverride | null): number {
  return Math.floor(getEffectiveNowMs(override) / 1000);
}

export function getEffectiveNowDate(override?: TeamTimeOverride | null): Date {
  return new Date(getEffectiveNowMs(override));
}

export function toLocalDateTimeInputValue(epochMs: number): string {
  const date = new Date(epochMs);
  const pad = (value: number) => String(value).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}
