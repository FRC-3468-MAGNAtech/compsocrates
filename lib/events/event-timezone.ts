// Where an event is, and so what its clock says. The events APIs give each event a location (country, state or province, city) and sometimes a timezone, but
// not always a usable one: it can be missing, or a Windows-style name ("AUS Eastern Standard Time") that `Intl` does not know. Match times arrive as the venue's
// wall clock with no offset, so reading them needs the venue's zone: the wrong zone shifts every time by the difference. This module settles the zone:
//   1. an IANA zone the API gave (America/Los_Angeles): used as is;
//   2. a Windows zone name: mapped to its IANA zone;
//   3. otherwise the event's location: country, then state or province, then the country's zone;
//   4. otherwise null, and the caller falls back to the viewer's own zone (never a guess shifted by a fixed number of hours).
// The viewer's zone is compared with the event's at display time (`lib/dashboard/time.ts`). Pure; no network.

export type EventPlace = {
  timezone?: string | null;
  country?: string | null;
  stateProv?: string | null;
  city?: string | null;
};

/** Does `Intl` know this zone id? */
export function isIanaZone(zone: string | null | undefined): boolean {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const WINDOWS_ZONES: Readonly<Record<string, string>> = {
  "pacific standard time": "America/Los_Angeles",
  "pacific standard time (mexico)": "America/Tijuana",
  "mountain standard time": "America/Denver",
  "us mountain standard time": "America/Phoenix",
  "central standard time": "America/Chicago",
  "canada central standard time": "America/Regina",
  "central standard time (mexico)": "America/Mexico_City",
  "eastern standard time": "America/New_York",
  "us eastern standard time": "America/Indiana/Indianapolis",
  "atlantic standard time": "America/Halifax",
  "newfoundland standard time": "America/St_Johns",
  "alaskan standard time": "America/Anchorage",
  "hawaiian standard time": "Pacific/Honolulu",
  "e. south america standard time": "America/Sao_Paulo",
  "gmt standard time": "Europe/London",
  "greenwich standard time": "Atlantic/Reykjavik",
  "w. europe standard time": "Europe/Berlin",
  "central europe standard time": "Europe/Budapest",
  "central european standard time": "Europe/Warsaw",
  "romance standard time": "Europe/Paris",
  "gtb standard time": "Europe/Bucharest",
  "fle standard time": "Europe/Kyiv",
  "turkey standard time": "Europe/Istanbul",
  "israel standard time": "Asia/Jerusalem",
  "arabian standard time": "Asia/Dubai",
  "india standard time": "Asia/Kolkata",
  "china standard time": "Asia/Shanghai",
  "taipei standard time": "Asia/Taipei",
  "singapore standard time": "Asia/Singapore",
  "tokyo standard time": "Asia/Tokyo",
  "korea standard time": "Asia/Seoul",
  "w. australia standard time": "Australia/Perth",
  "aus central standard time": "Australia/Darwin",
  "cen. australia standard time": "Australia/Adelaide",
  "e. australia standard time": "Australia/Brisbane",
  "aus eastern standard time": "Australia/Sydney",
  "tasmania standard time": "Australia/Hobart",
  "new zealand standard time": "Pacific/Auckland",
  utc: "UTC",
};

const US_STATES: Readonly<Record<string, string>> = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix", AR: "America/Chicago", CA: "America/Los_Angeles", CO: "America/Denver",
  CT: "America/New_York", DE: "America/New_York", DC: "America/New_York", FL: "America/New_York", GA: "America/New_York", HI: "Pacific/Honolulu",
  ID: "America/Boise", IL: "America/Chicago", IN: "America/Indiana/Indianapolis", IA: "America/Chicago", KS: "America/Chicago", KY: "America/New_York",
  LA: "America/Chicago", ME: "America/New_York", MD: "America/New_York", MA: "America/New_York", MI: "America/Detroit", MN: "America/Chicago",
  MS: "America/Chicago", MO: "America/Chicago", MT: "America/Denver", NE: "America/Chicago", NV: "America/Los_Angeles", NH: "America/New_York",
  NJ: "America/New_York", NM: "America/Denver", NY: "America/New_York", NC: "America/New_York", ND: "America/Chicago", OH: "America/New_York",
  OK: "America/Chicago", OR: "America/Los_Angeles", PA: "America/New_York", RI: "America/New_York", SC: "America/New_York", SD: "America/Chicago",
  TN: "America/Chicago", TX: "America/Chicago", UT: "America/Denver", VT: "America/New_York", VA: "America/New_York", WA: "America/Los_Angeles",
  WV: "America/New_York", WI: "America/Chicago", WY: "America/Denver", PR: "America/Puerto_Rico", GU: "Pacific/Guam",
};
const US_STATE_NAMES: Readonly<Record<string, string>> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME",
  maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "puerto rico": "PR", guam: "GU",
};

const CA_PROVINCES: Readonly<Record<string, string>> = {
  BC: "America/Vancouver", AB: "America/Edmonton", SK: "America/Regina", MB: "America/Winnipeg", ON: "America/Toronto", QC: "America/Toronto",
  NB: "America/Moncton", NS: "America/Halifax", PE: "America/Halifax", NL: "America/St_Johns", YT: "America/Whitehorse", NT: "America/Yellowknife", NU: "America/Iqaluit",
};
const CA_PROVINCE_NAMES: Readonly<Record<string, string>> = {
  "british columbia": "BC", alberta: "AB", saskatchewan: "SK", manitoba: "MB", ontario: "ON", quebec: "QC", "québec": "QC", "new brunswick": "NB", "nova scotia": "NS",
  "prince edward island": "PE", "newfoundland and labrador": "NL", yukon: "YT", "northwest territories": "NT", nunavut: "NU",
};

const AU_STATES: Readonly<Record<string, string>> = {
  NSW: "Australia/Sydney", ACT: "Australia/Sydney", VIC: "Australia/Melbourne", QLD: "Australia/Brisbane", WA: "Australia/Perth", SA: "Australia/Adelaide",
  TAS: "Australia/Hobart", NT: "Australia/Darwin",
};
const AU_STATE_NAMES: Readonly<Record<string, string>> = {
  "new south wales": "NSW", "australian capital territory": "ACT", victoria: "VIC", queensland: "QLD", "western australia": "WA", "south australia": "SA",
  tasmania: "TAS", "northern territory": "NT",
};

type CountryRule = { names: readonly string[]; zone?: string; region?: { abbr: Readonly<Record<string, string>>; names: Readonly<Record<string, string>> } };

// A country with one zone (or a sensible primary zone) and, where the zone depends on the state, a region table.
const COUNTRIES: readonly CountryRule[] = [
  { names: ["usa", "us", "u.s.a.", "united states", "united states of america"], zone: undefined, region: { abbr: US_STATES, names: US_STATE_NAMES } },
  { names: ["canada"], zone: undefined, region: { abbr: CA_PROVINCES, names: CA_PROVINCE_NAMES } },
  { names: ["australia", "au"], zone: "Australia/Sydney", region: { abbr: AU_STATES, names: AU_STATE_NAMES } },
  { names: ["new zealand", "nz"], zone: "Pacific/Auckland" },
  { names: ["mexico", "méxico"], zone: "America/Mexico_City" },
  { names: ["brazil", "brasil"], zone: "America/Sao_Paulo" },
  { names: ["israel"], zone: "Asia/Jerusalem" },
  { names: ["turkey", "türkiye", "turkiye"], zone: "Europe/Istanbul" },
  { names: ["china", "peoples republic of china", "people's republic of china"], zone: "Asia/Shanghai" },
  { names: ["chinese taipei", "taiwan"], zone: "Asia/Taipei" },
  { names: ["japan"], zone: "Asia/Tokyo" },
  { names: ["south korea", "korea", "republic of korea"], zone: "Asia/Seoul" },
  { names: ["india"], zone: "Asia/Kolkata" },
  { names: ["singapore"], zone: "Asia/Singapore" },
  { names: ["united arab emirates", "uae"], zone: "Asia/Dubai" },
  { names: ["united kingdom", "uk", "great britain", "england", "scotland", "wales", "northern ireland"], zone: "Europe/London" },
  { names: ["ireland"], zone: "Europe/Dublin" },
  { names: ["germany"], zone: "Europe/Berlin" },
  { names: ["france"], zone: "Europe/Paris" },
  { names: ["netherlands", "the netherlands"], zone: "Europe/Amsterdam" },
  { names: ["poland"], zone: "Europe/Warsaw" },
  { names: ["romania"], zone: "Europe/Bucharest" },
  { names: ["ukraine"], zone: "Europe/Kyiv" },
  { names: ["spain"], zone: "Europe/Madrid" },
  { names: ["italy"], zone: "Europe/Rome" },
  { names: ["colombia"], zone: "America/Bogota" },
  { names: ["chile"], zone: "America/Santiago" },
  { names: ["dominican republic"], zone: "America/Santo_Domingo" },
  { names: ["kazakhstan"], zone: "Asia/Almaty" },
];

const norm = (v: string | null | undefined): string => String(v ?? "").trim().toLowerCase();

/** The zone for a location, or null when the country is unknown or (for a country whose zone depends on the region) the region is. */
export function zoneFromLocation(place: Pick<EventPlace, "country" | "stateProv">): string | null {
  const country = norm(place.country);
  if (!country) return null;
  const rule = COUNTRIES.find((c) => c.names.includes(country));
  if (!rule) return null;
  const region = String(place.stateProv ?? "").trim();
  if (rule.region && region) {
    const abbr = rule.region.abbr[region.toUpperCase()] ? region.toUpperCase() : (rule.region.names[norm(region)] ?? null);
    if (abbr && rule.region.abbr[abbr]) return rule.region.abbr[abbr];
  }
  return rule.zone ?? null;
}

/**
 * The IANA zone of an event: the API's own when `Intl` knows it, else its Windows-name equivalent, else from where the event is. Null when none of those
 * says (the caller then reads times in the viewer's zone, the old behavior, rather than inventing an offset).
 */
export function resolveEventTimeZone(place: EventPlace): string | null {
  const given = String(place.timezone ?? "").trim();
  if (isIanaZone(given)) return given;
  const fromWindows = WINDOWS_ZONES[given.toLowerCase()];
  if (fromWindows) return fromWindows;
  return zoneFromLocation(place);
}

/** `event` with its `timezone` settled by `resolveEventTimeZone` (the one place an event gets its zone). */
export function withResolvedTimeZone<T extends EventPlace>(event: T): T & { timezone: string | null } {
  return { ...event, timezone: resolveEventTimeZone(event) };
}
