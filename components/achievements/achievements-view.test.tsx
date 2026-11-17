import { renderToString as render } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/program/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import { EMPTY_ACHIEVEMENT_CONFIG } from "@/lib/achievements/config";
import type { AchievementFacts } from "@/lib/achievements/metrics";
import { buildItems } from "@/lib/achievements/view";
import { Progress } from "@/components/ui/progress";
import { AchievementsCompact, AchievementsView } from "./achievements-view";

const facts: AchievementFacts = { "practice-sessions": { all: { value: 3, samples: 3 }, season: null }, "longest-streak": { all: { value: 4, samples: 3 }, season: null } };
const renderToString = (el: React.ReactElement) => render(el).replace(/<!-- -->/g, "");
const items = buildItems(EMPTY_ACHIEVEMENT_CONFIG, facts, "all");

describe("Progress", () => {
  it("is an accessible progressbar with its values and a label", () => {
    const html = renderToString(<Progress value={3} max={5} label="Practice Pro" />);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="3"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="5"');
    expect(html).toContain('aria-label="Practice Pro"');
  });
  it("caps the value at the maximum", () => {
    expect(renderToString(<Progress value={9} max={5} label="x" />)).toContain('aria-valuenow="5"');
  });
});

describe("Achievements page body", () => {
  it("shows every achievement with a progress bar, grouped, and the earned count", () => {
    const html = renderToString(<AchievementsView items={items} noTeam={false} />);
    expect(html).toContain("1 of 8 earned");
    expect(html).toContain('data-testid="achievement-first-session"');
    expect((html.match(/role="progressbar"/g) ?? []).length).toBe(8);
    expect(html).toContain("Practice");
    expect(html).toContain("Accuracy");
  });
  it("a no-team account sees the explanation and every achievement at zero", () => {
    const empty = buildItems(EMPTY_ACHIEVEMENT_CONFIG, {}, "all");
    const html = renderToString(<AchievementsView items={empty} noTeam />);
    expect(html).toContain('data-testid="achievements-no-team"');
    expect(html).toContain("0 of 8 earned");
  });
});

describe("profile section", () => {
  it("the owner sees the count, the closest next one with its bar, and See all", () => {
    const html = renderToString(<AchievementsCompact items={items} isSelf />);
    expect(html).toContain("1 of 8");
    expect(html).toContain("Next up: 5-Day Streak");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('href="/achievements"');
  });
  it("another viewer sees only the earned ones: no bars, no unearned names, no counts of the rest", () => {
    const html = renderToString(<AchievementsCompact items={items} isSelf={false} />);
    expect(html).toContain("First Session");
    expect(html).not.toContain("10 Sessions");
    expect(html).not.toContain("5-Day Streak");
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain("See all");
    expect(html).not.toMatch(/\d+ of \d+/);
  });
  it("another viewer of someone with none earned sees a plain line", () => {
    const html = renderToString(<AchievementsCompact items={buildItems(EMPTY_ACHIEVEMENT_CONFIG, {}, "all")} isSelf={false} />);
    expect(html).toContain("No achievements earned yet");
  });
});
