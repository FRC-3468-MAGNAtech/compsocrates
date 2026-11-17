import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GAME_DEFINITIONS, GAME_ID_LIST } from "@/config/games";
import { GameSelect } from "@/components/scout/game-select";
import { ScoutForm } from "@/components/scout/scout-form";
import { BUILTIN_FORMS } from "@/lib/forms/builtin";
import { getEnabledSeasons } from "@/lib/seasons";

// The match scout form renders for EVERY game from its generated (or hand-built) form: its sections, its field labels and the submit button. Server render, like
// scout-form.parity.smoke.test.tsx (it proves nothing throws and the labels the definition declares are on the screen).

const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

describe.each(GAME_ID_LIST)("Match Scout Form renders for %s", (gameId) => {
  const def = GAME_DEFINITIONS[gameId];
  const form = BUILTIN_FORMS[def.formId];
  const html = text(renderToString(<ScoutForm schema={form} mode="event" prefill={{ scoutName: "Ann" }} />));

  it("shows the phases, the submit button and the scout name", () => {
    expect(html).toContain("Submit match");
    expect(html).toContain("Autonomous");
    expect(html).toContain("Endgame");
    expect(html).toContain("Ann");
  });

  it("shows every field label the definition declares for a point-table game", () => {
    if (def.formulas) return; // REBUILT's form is hand-built (covered by scout-form.parity.smoke.test.tsx)
    for (const field of (def.fields ?? []).filter((f) => f.kind === "counter" || f.kind === "toggle")) expect(html, field.key).toContain(field.label);
  });

  it("shows the incident checkboxes and the notes field", () => {
    for (const incident of def.incidents) expect(html, incident.value).toContain(incident.label);
    expect(html).toContain("Notes");
  });
});

describe("the game selector", () => {
  it("lists the three games from the registry, REBUILT chosen by default", () => {
    expect(getEnabledSeasons().map((s) => s.name)).toEqual(["REBUILT", "REEFSCAPE", "CHARGED UP"]);
    const html = text(renderToString(<GameSelect value="rebuilt" onChange={() => {}} />));
    expect(html).toContain("Game");
    expect(html).toContain("REBUILT");
  });

  it("shows the chosen game", () => {
    expect(text(renderToString(<GameSelect value="charged_up" onChange={() => {}} />))).toContain("CHARGED UP");
    expect(text(renderToString(<GameSelect value="reefscape" onChange={() => {}} />))).toContain("REEFSCAPE");
  });
});
