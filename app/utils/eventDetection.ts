import { doc, getDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import { APP_EVENTS, dedupeEventKeys } from "@/app/utils/events";
import { getEffectiveNowDate, getEffectiveNowMs, parseTeamTimeOverride } from "@/app/utils/teamTime";

export type DetectedEventOption = {
  key: string;
  name: string;
  startDate: string;
  endDate: string;
};

function toDateStart(dateValue: string): number {
  if (!dateValue) return 0;
  const parsed = new Date(`${dateValue}T00:00:00`).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDateEnd(dateValue: string): number {
  if (!dateValue) return 0;
  const parsed = new Date(`${dateValue}T23:59:59`).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function pickDetectedEventKey(events: DetectedEventOption[], now = Date.now()): string {
  if (events.length === 0) return "app-testing";

  const withTime = events.map((event) => ({
    ...event,
    startMs: toDateStart(event.startDate),
    endMs: toDateEnd(event.endDate || event.startDate),
  }));

  const active = withTime
    .filter((event) => event.startMs > 0 && event.endMs > 0 && now >= event.startMs && now <= event.endMs)
    .sort((a, b) => a.startMs - b.startMs)[0];
  if (active?.key) return active.key;

  const latestPast = withTime
    .filter((event) => event.endMs > 0 && event.endMs < now)
    .sort((a, b) => b.endMs - a.endMs)[0];
  if (latestPast?.key) return latestPast.key;

  return "app-testing";
}

export async function getTeamEventOptions(teamId: string): Promise<DetectedEventOption[]> {
  if (!teamId) return [];
  const teamDoc = await getDoc(doc(db, "teams", teamId));
  if (!teamDoc.exists()) return [];
  const teamData = teamDoc.data() as Record<string, unknown>;
  const override = parseTeamTimeOverride(teamData);
  const baseYear = getEffectiveNowDate(override).getFullYear();
  const selectedEvents = Array.isArray(teamData.selectedEvents)
    ? dedupeEventKeys(teamData.selectedEvents.map((value) => String(value || "").trim()).filter(Boolean))
    : [];

  if (selectedEvents.length === 0) {
    return APP_EVENTS.map((event) => ({
      key: event.key,
      name: event.name,
      startDate: event.startDate,
      endDate: event.endDate,
    }));
  }

  const encryptedKey = typeof teamData.tbaApiKeyEncrypted === "string" ? teamData.tbaApiKeyEncrypted.trim() : "";
  const plainKey = typeof teamData.tbaApiKey === "string" ? teamData.tbaApiKey.trim() : "";
  const selectedSet = new Set(selectedEvents);
  const byKey = new Map<string, DetectedEventOption>();

  if (encryptedKey || plainKey) {
    const years = new Set<number>();
    selectedEvents.forEach((eventKey) => {
      const year = Number(eventKey.slice(0, 4));
      if (Number.isFinite(year)) years.add(year);
    });
    if (years.size === 0) years.add(baseYear);

    const responses = await Promise.all(
      Array.from(years).map(async (year) => {
        const response = await fetch("/api/tba/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ year, encryptedKey, plainKey }),
        });
        if (!response.ok) return [] as Array<Record<string, unknown>>;
        const payload = (await response.json()) as { events?: Array<Record<string, unknown>> };
        return Array.isArray(payload.events) ? payload.events : [];
      })
    );

    responses.flat().forEach((event) => {
      const key = String(event.key || "").trim();
      if (!key || !selectedSet.has(key)) return;
      byKey.set(key, {
        key,
        name: String(event.name || key),
        startDate: String(event.start_date || ""),
        endDate: String(event.end_date || event.start_date || ""),
      });
    });
  }

  const appByKey = new Map(APP_EVENTS.map((event) => [event.key, event]));
  selectedEvents.forEach((eventKey) => {
    if (byKey.has(eventKey)) return;
    const appEvent = appByKey.get(eventKey);
    byKey.set(eventKey, {
      key: eventKey,
      name: appEvent?.name || eventKey,
      startDate: appEvent?.startDate || "",
      endDate: appEvent?.endDate || appEvent?.startDate || "",
    });
  });

  return Array.from(byKey.values()).sort((a, b) => {
    const aStart = toDateStart(a.startDate);
    const bStart = toDateStart(b.startDate);
    if (aStart && bStart && aStart !== bStart) return aStart - bStart;
    if (aStart && !bStart) return -1;
    if (!aStart && bStart) return 1;
    return a.name.localeCompare(b.name);
  });
}

export async function resolveDetectedTeamEvent(teamId: string): Promise<DetectedEventOption | null> {
  const [options, teamDoc] = await Promise.all([
    getTeamEventOptions(teamId),
    getDoc(doc(db, "teams", teamId)),
  ]);
  if (options.length === 0) return null;
  const override = teamDoc.exists() ? parseTeamTimeOverride(teamDoc.data() as Record<string, unknown>) : null;
  const key = pickDetectedEventKey(options, getEffectiveNowMs(override));
  if (key === "app-testing") {
    return {
      key: "app-testing",
      name: "App Testing",
      startDate: "",
      endDate: "",
    };
  }
  return options.find((event) => event.key === key) || options[0] || null;
}

export async function resolveDetectedTeamEventKey(teamId: string): Promise<string> {
  const resolved = await resolveDetectedTeamEvent(teamId);
  return resolved?.key || "app-testing";
}
