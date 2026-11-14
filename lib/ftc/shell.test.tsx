import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProgramAuth } from "@/components/program/program-auth";
import { UnconnectedPage } from "@/components/program/unconnected-page";
import { DEFAULT_PROGRAM, type ProgramId } from "@/config/programs/types";
import { AuthContext, useAuth, type AuthContextValue } from "@/lib/auth";
import { buildFormsValue } from "@/lib/forms/forms-context";
import { emptyCatalog } from "@/lib/forms/resolve";
import { ftcProgramData } from "@/lib/ftc/program-data";
import { ProgramProvider } from "@/lib/program/context";

const games = ftcProgramData.games;

describe("the forms context for a program with its own games", () => {
  const catalog = { docs: new Map(), versions: new Map(), builtins: games.builtinForms };
  const value = buildFormsValue(catalog, true, {}, () => {}, new Set(), games);

  it("offers the program's seasons and default, and the form of its game", () => {
    expect(value.seasons.map((s) => s.id)).toEqual(["biobuzz"]);
    expect(value.defaultSeasonId).toBe("biobuzz");
    expect(value.formIdForSeason()).toBe("biobuzz");
    expect(value.activeFormFor().id).toBe("biobuzz");
    expect(value.activeFormFor("biobuzz").id).toBe("biobuzz");
    expect(value.activeFormFor("some-unknown-season").id).toBe("biobuzz");
    expect(value.latest("biobuzz")?.id).toBe("biobuzz");
    // the program's built-in forms are the ones it lists: its game and the six other forms
    expect(value.summaries.map((s) => s.id).sort()).toEqual(["biobuzz", "drive-reflection-v1", "helper-v1", "lead-scout-v1", "match-strategy-v1", "pit-scout-v1", "team-strategy-v1"]);
  });

  it("an entry resolves to the program's built-in form, and the default program's forms are not visible", () => {
    expect(value.forEntry({ formId: "biobuzz", formVersion: 1 })?.id).toBe("biobuzz");
    expect(value.latest("rebuilt")).toBeNull();
    expect(value.forEntry({ formId: "rebuilt" })).toBeNull();
  });

  it("without a program port it is exactly what it was: the default program's seasons, default and forms", () => {
    const root = buildFormsValue(emptyCatalog(), true, {}, () => {});
    expect(root.defaultSeasonId).toBe("rebuilt");
    expect(root.seasons.map((s) => s.id)).toEqual(["rebuilt", "reefscape", "charged_up"]);
    expect(root.latest("rebuilt")?.id).toBe("rebuilt");
    expect(root.latest("biobuzz")).toBeNull();
    expect(root.activeFormFor().id).toBe("rebuilt");
  });
});

function Probe() {
  const auth = useAuth();
  return createElement("span", { "data-loading": String(auth.loading), "data-profile": auth.profile?.name ?? "none" });
}

function renderAuth(program: ProgramId, base: Partial<AuthContextValue>): string {
  const tree: ReactNode = (
    <AuthContext.Provider value={base as AuthContextValue}>
      <ProgramProvider program={program}>
        <ProgramAuth>
          <Probe />
        </ProgramAuth>
      </ProgramProvider>
    </AuthContext.Provider>
  );
  return renderToStaticMarkup(tree);
}

describe("ProgramAuth", () => {
  const signedIn = { user: { uid: "u1" } as AuthContextValue["user"], profile: { name: "Root Name" } as AuthContextValue["profile"], loading: false };

  it("leaves the default program's auth untouched", () => {
    const html = renderAuth(DEFAULT_PROGRAM, signedIn);
    expect(html).toContain('data-profile="Root Name"');
    expect(html).toContain('data-loading="false"');
  });

  it("in a program with its own profile, never shows the default program's profile, and is loading until its own arrives", () => {
    const html = renderAuth("ftc", signedIn);
    expect(html).toContain('data-profile="none"');
    expect(html).toContain('data-loading="true"');
  });

  it("signed out: no profile, and nothing to wait for", () => {
    const html = renderAuth("ftc", { user: null, profile: null, loading: false });
    expect(html).toContain('data-profile="none"');
    expect(html).toContain('data-loading="false"');
  });

  it("still waits for the sign-in itself", () => {
    expect(renderAuth("ftc", { user: null, profile: null, loading: true })).toContain('data-loading="true"');
  });
});

describe("UnconnectedPage", () => {
  it("tells the person the page is not ready and points at one that is", () => {
    const html = renderToStaticMarkup(
      <ProgramProvider program="ftc">
        <UnconnectedPage />
      </ProgramProvider>
    );
    expect(html).toContain('data-testid="unconnected-page"');
    expect(html).toContain("Not available in FTC yet");
    expect(html).toContain('href="/ftc/scout"');
  });
});
