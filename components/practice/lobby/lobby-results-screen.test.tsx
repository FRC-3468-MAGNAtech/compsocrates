import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LobbyResultsScreen } from "@/components/practice/lobby/lobby-results-screen";
import { ProgramProvider } from "@/lib/program/context";

const h = vi.hoisted(() => ({ sessions: [] as Record<string, unknown>[] }));
vi.mock("@/lib/lobby", () => ({ useLobbySessions: () => ({ sessions: h.sessions }), updateLobby: vi.fn() }));
vi.mock("@/lib/match-library", () => ({ useLibraryMatchesBySeason: () => ({ matches: [] }) }));

const lobby = {
  id: "LB-AAAAAA", teamId: "T1", seasonId: "s", status: "results", libraryMatchId: "m1",
  pairing: [{ pairId: "p1", alliance: "red", playerUids: ["a", "b"], robots: [100, 200] }],
};
const players = [{ uid: "a", name: "Ada" }, { uid: "b", name: "Bo" }];
const session = (uid: string, over: Record<string, unknown> = {}) => ({
  id: `s-${uid}`, uid, pairId: "p1", status: "completed", accuracy: null, scoutedTotal: 87, officialScore: null, penaltyPoints: 5, robots: [uid === "a" ? 100 : 200], entryIds: ["e"], ...over,
});

const render = (program: "frc" | "ftc") =>
  renderToStaticMarkup(
    <ProgramProvider program={program}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <LobbyResultsScreen lobby={lobby as any} players={players as any} isHost={false} onExit={() => undefined} />
    </ProgramProvider>,
  );

describe("lobby results for a group scouted on a match with no official score", () => {
  it("a program that treats no score as a result lists the group with its scouted total, never under Did not finish", () => {
    h.sessions = [session("a"), session("b")];
    const html = render("ftc");
    expect(html).toContain("No official score yet");
    expect(html).toContain("87 pts");
    expect(html).not.toContain("Did not finish");
  });

  it("a scored group is ranked as before (accuracy shown, no unscored panel)", () => {
    h.sessions = [session("a", { accuracy: 90, officialScore: 85 }), session("b", { accuracy: 90, officialScore: 85 })];
    const html = render("ftc");
    expect(html).toContain("90%");
    expect(html).not.toContain("No official score yet");
  });

  it("an unfinished group (one of two players done) is still Did not finish", () => {
    h.sessions = [session("a")];
    expect(render("ftc")).toContain("Did not finish");
  });

  it("the default program is unchanged: an unscored group is still Did not finish (its library matches always have a score)", () => {
    h.sessions = [session("a"), session("b")];
    const html = render("frc");
    expect(html).toContain("Did not finish");
    expect(html).not.toContain("No official score yet");
  });
});
