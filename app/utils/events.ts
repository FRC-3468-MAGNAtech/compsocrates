export type AppEvent = {
  key: string;
  name: string;
  location: string;
  city: string;
  state_prov: string;
  country: string;
  startDate: string;
  endDate: string;
  week: number;
  event_type: string;
};

export const APP_EVENTS: AppEvent[] = [
  {
    key: "2026arli",
    name: "Arkansas Regional",
    location: "Little Rock, AR",
    city: "Little Rock",
    state_prov: "AR",
    country: "USA",
    startDate: "2026-03-18",
    endDate: "2026-03-21",
    week: 3,
    event_type: "Regional",
  },
  {
    key: "2026labr",
    name: "Bayou Regional",
    location: "Kenner, LA",
    city: "Kenner",
    state_prov: "LA",
    country: "USA",
    startDate: "2026-04-01",
    endDate: "2026-04-04",
    week: 4,
    event_type: "Regional",
  },
];

export const APP_EVENT_BY_KEY = APP_EVENTS.reduce<Record<string, AppEvent>>((acc, event) => {
  acc[event.key] = event;
  return acc;
}, {});
