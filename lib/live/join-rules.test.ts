import { describe, expect, it } from "vitest";
import { determineJoinOption } from "./join-rules";

const RED: [number, number] = [100, 200];
const BLUE: [number, number] = [300, 400];

describe("determineJoinOption", () => {
  it("returns 'none' when nobody is covering the match yet", () => {
    expect(determineJoinOption([], RED, BLUE)).toEqual({ kind: "none" });
  });

  it("forces the joiner onto the same alliance's other robot", () => {
    const result = determineJoinOption([{ teamNumber: 100, alliance: "red" }], RED, BLUE);
    expect(result).toEqual({ kind: "forced", alliance: "red", teamNumber: 200 });
  });

  it("offers a free choice from the other alliance once the first is fully covered", () => {
    const covered = [
      { teamNumber: 100, alliance: "red" as const },
      { teamNumber: 200, alliance: "red" as const },
    ];
    const result = determineJoinOption(covered, RED, BLUE);
    expect(result).toEqual({ kind: "choice", alliance: "blue", teamNumbers: BLUE });
  });

  it("returns 'none' once both alliances are fully covered", () => {
    const covered = [
      { teamNumber: 100, alliance: "red" as const },
      { teamNumber: 200, alliance: "red" as const },
      { teamNumber: 300, alliance: "blue" as const },
      { teamNumber: 400, alliance: "blue" as const },
    ];
    expect(determineJoinOption(covered, RED, BLUE)).toEqual({ kind: "none" });
  });

  it("forces onto whichever alliance is partially covered when both have exactly one", () => {
    const covered = [
      { teamNumber: 100, alliance: "red" as const },
      { teamNumber: 300, alliance: "blue" as const },
    ];
    const result = determineJoinOption(covered, RED, BLUE);
    expect(result.kind).toBe("forced");
  });
});

describe("determineJoinOption — 3-robot alliances", () => {
  const RED3 = [100, 200, 300];
  const BLUE3 = [400, 500, 600];
  const c = (teamNumber: number, alliance: "red" | "blue") => ({ teamNumber, alliance });

  it("lets the joiner pick between the two uncovered robots when one of three is covered", () => {
    expect(determineJoinOption([c(100, "red")], RED3, BLUE3)).toEqual({ kind: "choice", alliance: "red", teamNumbers: [200, 300] });
  });

  it("forces the last uncovered robot once two of three are covered", () => {
    expect(determineJoinOption([c(100, "red"), c(300, "red")], RED3, BLUE3)).toEqual({ kind: "forced", alliance: "red", teamNumber: 200 });
  });

  it("offers the whole other alliance once one is fully covered (all three)", () => {
    expect(determineJoinOption([c(100, "red"), c(200, "red"), c(300, "red")], RED3, BLUE3)).toEqual({ kind: "choice", alliance: "blue", teamNumbers: BLUE3 });
  });

  it("returns 'none' when both alliances are fully covered", () => {
    const covered = [...RED3.map((t) => c(t, "red")), ...BLUE3.map((t) => c(t, "blue"))];
    expect(determineJoinOption(covered, RED3, BLUE3)).toEqual({ kind: "none" });
  });

  it("completes the first partly covered alliance when both are partly covered", () => {
    const result = determineJoinOption([c(100, "red"), c(400, "blue"), c(500, "blue")], RED3, BLUE3);
    expect(result).toEqual({ kind: "choice", alliance: "red", teamNumbers: [200, 300] });
  });

  it("still treats a 2-team (FTC) alliance as full at two", () => {
    expect(determineJoinOption([c(100, "red"), c(200, "red")], RED, BLUE)).toEqual({ kind: "choice", alliance: "blue", teamNumbers: BLUE });
  });
});
