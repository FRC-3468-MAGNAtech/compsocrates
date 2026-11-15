import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DifficultySelect } from "@/components/practice/difficulty-select";

// Live and lobby entry points exist only where the program has them: a program without them shows no tile, no heading and no dead button.
describe("DifficultySelect entry points", () => {
  const noop = () => undefined;

  it("with live and lobby handlers (the default program) shows both tiles as before", () => {
    const html = renderToStaticMarkup(<DifficultySelect onSelect={noop} onSelectLive={noop} onSelectLobby={noop} />);
    expect(html).toContain("Other ways to scout");
    expect(html).toContain("Live Practice Lobby");
    expect(html).toContain("Scout a real, livestreamed FRC match.");
    expect(html).not.toContain("Any difficulty");
  });

  it("without them (solo practice only) shows only the three difficulties and no live or lobby clutter", () => {
    const html = renderToStaticMarkup(<DifficultySelect onSelect={vi.fn()} onSelectAny={noop} />);
    expect(html).not.toContain("Other ways to scout");
    expect(html).not.toContain("Lobby");
    expect(html).not.toContain("Live");
    expect(html).not.toContain("coming soon");
    for (const label of ["Easy", "Medium", "Hard", "Any difficulty"]) expect(html).toContain(label);
  });

  it("lobby alone or live alone shows just that tile", () => {
    const lobbyOnly = renderToStaticMarkup(<DifficultySelect onSelect={noop} onSelectLobby={noop} />);
    expect(lobbyOnly).toContain("Live Practice Lobby");
    expect(lobbyOnly).not.toContain("livestreamed");
    const liveOnly = renderToStaticMarkup(<DifficultySelect onSelect={noop} onSelectLive={noop} />);
    expect(liveOnly).toContain("livestreamed");
    expect(liveOnly).not.toContain("Lobby");
  });
});
