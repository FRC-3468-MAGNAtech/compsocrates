import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FiltersBar } from "./filters-bar";
import { deriveMyScoutingFilterOptions } from "@/lib/scout-stats/my-scouting-filters";

// Two people on the SAME team see different, personal filter options (Session 5).

const SEASONS = [
  { id: "rebuilt", name: "REBUILT" },
  { id: "reefscape", name: "REEFSCAPE" },
];
const NAMES: Record<string, string> = { "2026lake": "Bayou Regional", "2026arli": "Arkansas Regional", "2025lake": "Bayou Regional" };

// The whole team's data, as the page reads it (team-wide).
const entries = [
  { uid: "ann", source: "event", eventCode: "2026lake", submittedAt: "2026-03-01T00:00:00Z" },
  { uid: "ann", source: "event", eventCode: "2026arli", submittedAt: "2026-04-01T00:00:00Z" },
  { uid: "bo", source: "event", eventCode: "2026lake", submittedAt: "2026-03-02T00:00:00Z" },
];
const attendance = [
  { eventCode: "2026lake", uids: ["ann", "bo"] },
  { eventCode: "2025lake", uids: ["ann"] },
  { eventCode: "2026arli", uids: ["ann"] },
];

function markupFor(uid: string, profile: { primaryRole: string; secondaryRoles: string[] }) {
  const options = deriveMyScoutingFilterOptions({
    uid,
    entries,
    profile,
    attendance,
    keyShape: "tba",
    seasons: SEASONS,
    defaultSeasonId: "rebuilt",
    fallbackSeasonId: "reefscape",
    archivedEventCodes: ["2025lake"],
    eventName: (k) => NAMES[k],
  });
  const html = renderToStaticMarkup(
    createElement(FiltersBar, {
      category: "real-event",
      personal: { roles: options.roles, showRole: options.showRole, showEvent: options.showEvent },
      roleFilter: [],
      onRoleFilterChange: () => {},
      eventOptions: options.events.map((e) => ({ eventCode: e.key, eventName: e.displayLabel })),
      eventFilter: [],
      onEventFilterChange: () => {},
      rankingBasis: "preserve",
      onRankingBasisChange: () => {},
      realEventScope: { eventCode: null, variant: "plain" },
      onRealEventScopeChange: () => {},
    })
  );
  return { html, options };
}

describe("My Scouting filters for two people on one team", () => {
  const ann = markupFor("ann", { primaryRole: "lead-scout", secondaryRoles: ["pit-scout"] });
  const bo = markupFor("bo", { primaryRole: "match-scout", secondaryRoles: [] });

  it("one person with several roles and events sees all of theirs, and only theirs", () => {
    expect(ann.html).toContain("Role filter");
    for (const label of ["Match Scout", "Pit Scout", "Lead Scout"]) expect(ann.html).toContain(label);
    for (const label of ["Team Coach", "Drive Team", "Media", "Judge Awards", "Pit Team", "Lead Strategist"]) expect(ann.html).not.toContain(label);
    expect(ann.html).toContain("Event filter");
    expect(ann.html).toContain("Bayou Regional 2026");
    expect(ann.html).toContain("Arkansas Regional 2026");
    expect(ann.html).toContain("Bayou Regional 2025 (Archived)");
  });

  it("the other person (one role, one event) sees no role or event filter at all", () => {
    expect(bo.html).not.toContain("Role filter");
    expect(bo.html).not.toContain("Event filter");
    expect(bo.html).not.toContain("Arkansas Regional");
    expect(bo.html).not.toContain("Pit Scout");
  });

  it("the options differ between the two people", () => {
    expect(ann.options.roles.map((r) => r.id)).not.toEqual(bo.options.roles.map((r) => r.id));
    expect(ann.options.events.map((e) => e.key)).toEqual(["2026arli", "2026lake", "2025lake"]);
    expect(bo.options.events.map((e) => e.key)).toEqual(["2026lake"]);
  });

  it("without `personal` (Scout Accuracy) every role still shows", () => {
    const html = renderToStaticMarkup(
      createElement(FiltersBar, {
        category: "real-event",
        roleFilter: [],
        onRoleFilterChange: () => {},
        eventOptions: [],
        eventFilter: [],
        onEventFilterChange: () => {},
        rankingBasis: "preserve",
        onRankingBasisChange: () => {},
        realEventScope: { eventCode: null, variant: "plain" },
        onRealEventScopeChange: () => {},
      })
    );
    for (const label of ["Team Coach", "Drive Team", "Judge Awards"]) expect(html).toContain(label);
  });
});
