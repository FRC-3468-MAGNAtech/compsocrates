import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ComparisonRow } from "@/components/practice/comparison-row";
import { comparisonColumns } from "@/components/practice/comparison-columns";
import { DifficultySelect } from "@/components/practice/difficulty-select";
import { SeasonSelect } from "@/components/practice/season-select";
import { ProgramProvider } from "@/lib/program/context";

const seasons = vi.hoisted(() => ({ list: [{ id: "a", name: "Game A" }] as { id: string; name: string }[] }));
vi.mock("@/lib/forms/forms-context", () => ({ useForms: () => ({ seasons: seasons.list }) }));

const noop = () => undefined;
const robots = (n: number) => Array.from({ length: n }, (_, i) => ({ team: 100 + i, total: 10 * (i + 1) }));
const tiles = (html: string) => (html.match(/glass-card/g) ?? []).length;

// The Comparison row is ONE component for the solo and the live results screens, for 2-robot (FTC) and 3-robot (FRC) alliances.
describe("practice results Comparison row, 2 and 3 robots", () => {
  it("3 robots (FRC): 3 robot tiles + penalties + total, five columns", () => {
    const html = renderToStaticMarkup(<ComparisonRow robots={robots(3)} penalties={4} totalLabel="= Your total" total={60} />);
    expect(tiles(html)).toBe(5);
    expect(html).toContain("sm:grid-cols-5");
    for (const t of ["Team 100", "Team 101", "Team 102", "+ Penalties", "= Your total"]) expect(html).toContain(t);
  });

  it("2 robots (FTC): 2 robot tiles + penalties + total, four columns, no third robot tile", () => {
    const html = renderToStaticMarkup(<ComparisonRow robots={robots(2)} penalties={4} totalLabel="= Your total" total={30} />);
    expect(tiles(html)).toBe(4);
    expect(html).toContain("sm:grid-cols-4");
    expect(html).not.toContain("Team 102");
  });

  it("no official score yet (no penalties tile): 2 robots give three columns, 3 robots give four", () => {
    expect(comparisonColumns(2, false)).toBe("sm:grid-cols-3");
    expect(comparisonColumns(3, false)).toBe("sm:grid-cols-4");
    expect(tiles(renderToStaticMarkup(<ComparisonRow robots={robots(2)} penalties={null} totalLabel="= Scouted total" total={30} />))).toBe(3);
  });

  it("a one-robot row still gets a real column class (the old table had no entry below 3)", () => {
    expect(comparisonColumns(1, false)).toBe("sm:grid-cols-2");
  });
});

describe("SeasonSelect (one game step for every program)", () => {
  it("one card for a one-game program, one per game otherwise", () => {
    seasons.list = [{ id: "a", name: "Game A" }];
    const one = renderToStaticMarkup(<SeasonSelect onSelect={noop} />);
    expect(one).toContain("Choose a season");
    expect(one).toContain("Game A");
    seasons.list = [
      { id: "a", name: "Game A" },
      { id: "b", name: "Game B" },
      { id: "c", name: "Game C" },
    ];
    const three = renderToStaticMarkup(<SeasonSelect onSelect={noop} />);
    for (const n of ["Game A", "Game B", "Game C"]) expect(three).toContain(n);
  });
});

describe("DifficultySelect", () => {
  it("offers 'Any difficulty' in every program (FRC and FTC alike)", () => {
    for (const program of ["frc", "ftc"] as const) {
      const html = renderToStaticMarkup(
        <ProgramProvider program={program}>
          <DifficultySelect onSelect={noop} onSelectAny={noop} />
        </ProgramProvider>,
      );
      expect(html).toContain("Any difficulty");
    }
  });

  it("takes the Live tile sentence from the program config", () => {
    const text = (program: "frc" | "ftc") =>
      renderToStaticMarkup(
        <ProgramProvider program={program}>
          <DifficultySelect onSelect={noop} onSelectLive={noop} />
        </ProgramProvider>,
      );
    expect(text("frc")).toContain("livestreamed FRC match");
    expect(text("ftc")).toContain("livestreamed FTC match");
  });
});
