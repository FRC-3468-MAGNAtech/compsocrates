import { expect, test, type Page } from "@playwright/test";
import { accessPageGroups } from "@/lib/page-access/page-list";
import { normalizeEntries } from "@/lib/sidebar/layout";

// P26: Admin Panel > Page Access and the no-access screen in a real browser, on /e2e/page-access (the real components on in-memory data). What the database
// lets each person write is proved by the emulator rules tests; who can open what is proved by lib/page-access/access.test.ts. This checks the screens.

async function open(page: Page, query = "") {
  await page.goto(`/e2e/page-access${query}`);
  await page.waitForFunction(() => Array.isArray(window.__pa));
}
const log = (page: Page) => page.evaluate(() => window.__pa ?? []);
async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

// The row count is whatever the app's own registry lists for the fixture's program (FRC, the default), never a hardcoded number.
const expectedPageRows = () => accessPageGroups("frc", normalizeEntries(null)).reduce((n, g) => n + g.rows.length, 0);

declare global {
  interface Window {
    __pa?: { type: string; [key: string]: unknown }[];
  }
}

test.describe("the role matrix", () => {
  test("rows are every page (grouped), columns the roles, ticked from the defaults; open pages are fully ticked", async ({ page }) => {
    await open(page, "?tab=roles");
    const matrix = page.getByTestId("role-matrix");
    await expect(matrix.locator("tbody tr[data-page]")).toHaveCount(expectedPageRows());
    await expect(page.getByTestId("matrix-media-match-list")).toHaveAttribute("data-state", "checked");
    await expect(page.getByTestId("matrix-media-dashboard")).toBeDisabled();
    await expect(matrix.locator("thead th")).toHaveCount(10); // the page column + 9 roles
    for (const [role, pageId] of [
      ["lead-scout", "assignments"],
      ["lead-scout", "lead-scout-form"],
      ["team-coach", "team-management"],
      ["pit-team", "helper-form"],
      ["pit-scout", "helper-form"],
      ["lead-strategist", "match-strategy-form"],
      ["drive-team", "drive-reflection-form"],
    ]) {
      await expect(page.getByTestId(`matrix-${role}-${pageId}`)).toHaveAttribute("data-state", "checked");
    }
    await expect(page.getByTestId("matrix-media-assignments")).toHaveAttribute("data-state", "unchecked");
    await expect(page.getByTestId("matrix-match-scout-team-management")).toHaveAttribute("data-state", "unchecked");
  });

  test("ticking and unticking saves, and the matrix follows", async ({ page }) => {
    await open(page, "?tab=roles");
    await page.getByTestId("matrix-media-assignments").click();
    await expect(page.getByTestId("matrix-media-assignments")).toHaveAttribute("data-state", "checked");
    await page.getByTestId("matrix-lead-scout-assignments").click();
    await expect(page.getByTestId("matrix-lead-scout-assignments")).toHaveAttribute("data-state", "unchecked");
    expect(await log(page)).toEqual([
      { type: "role", role: "media", pageId: "assignments", on: true },
      { type: "role", role: "lead-scout", pageId: "assignments", on: false },
    ]);
  });

  test("the page column stays put while the table scrolls sideways, and the page itself doesn't", async ({ page }) => {
    await open(page, "?tab=roles");
    const first = page.getByTestId("role-matrix").locator("tbody tr[data-page]").first().locator("th");
    await expect(first).toHaveCSS("position", "sticky");
    const scroller = page.getByTestId("role-matrix");
    const before = (await first.boundingBox())!;
    await scroller.evaluate((el) => (el.scrollLeft = 300));
    const after = (await first.boundingBox())!;
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
    await expectNoHorizontalScroll(page);
    // its backing is solid (opaque), so scrolled cells never show through
    const alpha = await first.evaluate((el) => {
      const c = getComputedStyle(el).backgroundColor;
      // The solid pinned surface is a `color-mix`, which the browser reports as `color(srgb r g b)` (alpha after a slash, 1 when absent).
      if (c.startsWith("color(")) return c.includes("/") ? Number(c.split("/")[1].replace(")", "")) : 1;
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return 0;
      const parts = m[1].split(/[,/ ]+/).filter(Boolean);
      return parts.length > 3 ? Number(parts[3]) : 1;
    });
    expect(alpha).toBeGreaterThanOrEqual(0.9);
  });
});

test.describe("member overrides, effective access and preview", () => {
  test("pick a member: where each page's access comes from, and grant / deny / follow roles", async ({ page }) => {
    await open(page, "?tab=members");
    await page.getByTestId("pa-member-select").click();
    await page.getByRole("option", { name: /Lee Lead/ }).click();
    const row = (id: string) => page.getByTestId("member-access-editor").locator(`li[data-page='${id}']`);

    await expect(row("assignments")).toHaveAttribute("data-allowed", "true");
    await expect(row("assignments").getByTestId("access-source")).toHaveText("Role: Lead Scout");
    await expect(row("team-management")).toHaveAttribute("data-allowed", "false");
    await expect(row("team-management").getByTestId("access-source")).toHaveText("No role or grant opens it");

    await page.getByTestId("override-team-management-grant").click();
    await expect(row("team-management")).toHaveAttribute("data-allowed", "true");
    await expect(row("team-management").getByTestId("access-source")).toHaveText("Extra page granted to this member");

    await page.getByTestId("override-assignments-deny").click();
    await expect(row("assignments")).toHaveAttribute("data-allowed", "false");
    await expect(row("assignments").getByTestId("access-source")).toContainText("Closed by an override");
    await expect(row("assignments").getByTestId("access-source")).toContainText("Lead Scout");

    await page.getByTestId("override-assignments-default").click();
    await expect(row("assignments")).toHaveAttribute("data-allowed", "true");
    expect(await log(page)).toEqual([
      { type: "member", uid: "lee", pageId: "team-management", state: "grant" },
      { type: "member", uid: "lee", pageId: "assignments", state: "deny" },
      { type: "member", uid: "lee", pageId: "assignments", state: "default" },
    ]);
  });

  test("a secondary role counts (Sam's Pit Team role opens the Helper Form)", async ({ page }) => {
    await open(page, "?tab=members&member=sam");
    const row = page.getByTestId("member-access-editor").locator("li[data-page='helper-form']");
    await expect(row).toHaveAttribute("data-allowed", "true");
    await expect(row.getByTestId("access-source")).toHaveText("Role: Pit Team");
  });

  test("Preview as member shows their navigation and pages, and follows the overrides", async ({ page }) => {
    await open(page, "?tab=members&member=mia");
    const nav = page.getByTestId("preview-nav");
    const pages = page.getByTestId("preview-pages");
    // Mia (Media): open pages only
    for (const label of ["Dashboard", "Match List", "Match Scout Form", "Analytics", "People", "Credits"]) await expect(nav).toContainText(label);
    for (const label of ["Assignments", "Team Management", "Scout Accuracy", "Active Events", "Admin Panel"]) await expect(nav).not.toContainText(label);
    await expect(pages.locator("li[data-page='assignments']")).toHaveAttribute("data-open", "false");
    await expect(pages.locator("li[data-page='match-list']")).toHaveAttribute("data-open", "true");
    await expect(pages.locator("li[data-page='admin-panel']")).toHaveAttribute("data-open", "false");

    await page.getByTestId("override-assignments-grant").click();
    await expect(nav).toContainText("Assignments");
    await expect(pages.locator("li[data-page='assignments']")).toHaveAttribute("data-open", "true");
  });

  test("an admin or the owner shows a note instead of overrides", async ({ page }) => {
    await open(page, "?tab=members&member=ada");
    await expect(page.getByTestId("member-admin-note")).toContainText("can always open every page");
    await expect(page.getByTestId("member-access-editor")).toHaveCount(0);
    await expect(page.getByTestId("preview-as-member")).toHaveCount(0);
  });
});

test.describe("access requests", () => {
  test("pending requests show a count, and Approve adds the grant (Deny only declines)", async ({ page }) => {
    await open(page, "?tab=requests");
    await expect(page.getByTestId("pending-count")).toHaveText("2");
    await expect(page.getByTestId("request-mia_assignments")).toContainText("Mia Media asked for Assignments");

    await page.getByTestId("approve-mia_assignments").click();
    await expect(page.getByTestId("request-mia_assignments")).toHaveCount(0);
    await expect(page.getByTestId("decided-mia_assignments")).toContainText("Approved");
    await page.getByTestId("deny-sam_team-management").click();
    await expect(page.getByTestId("decided-sam_team-management")).toContainText("Denied");
    await expect(page.getByTestId("no-pending-requests")).toBeVisible();
    await expect(page.getByTestId("pending-count")).toHaveCount(0);
    expect(await log(page)).toEqual([
      { type: "decide", id: "mia_assignments", approve: true },
      { type: "decide", id: "sam_team-management", approve: false },
    ]);

    // the approval is a grant: Mia now has Assignments, Sam still hasn't Team Management
    await page.getByTestId("pa-tab-members").click();
    await page.getByTestId("pa-member-select").click();
    await page.getByRole("option", { name: /Mia Media/ }).click();
    await expect(page.getByTestId("member-access-editor").locator("li[data-page='assignments'] [data-testid='access-source']")).toHaveText("Extra page granted to this member");
  });

  test("nothing waiting is said plainly", async ({ page }) => {
    await open(page, "?tab=requests&requests=none");
    await expect(page.getByTestId("no-pending-requests")).toContainText("No one is waiting for access");
  });
});

test.describe("the no-access screen", () => {
  test("says what's happening, offers Request access, and then shows the request was sent", async ({ page }) => {
    await open(page, "?view=no-access");
    await expect(page.getByRole("heading")).toHaveText("You don't have access to Assignments");
    await expect(page.getByTestId("request-access")).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to the dashboard" })).toHaveAttribute("href", "/frc/dashboard");
    await page.getByTestId("request-access").click();
    await expect(page.getByTestId("request-pending")).toContainText("Request sent");
    await expect(page.getByTestId("request-access")).toHaveCount(0); // no second request while one is pending
    expect(await log(page)).toEqual([{ type: "request", pageId: "assignments" }]);
    await expectNoHorizontalScroll(page);
  });

  test("a failed request says so and can be retried", async ({ page }) => {
    await open(page, "?view=no-access&fail=1");
    await page.getByTestId("request-access").click();
    await expect(page.getByTestId("request-error")).toContainText("Couldn't send that request");
    await expect(page.getByTestId("request-access")).toBeEnabled();
  });

  test("after a denial you can ask again; after an approval you're told to reload", async ({ page }) => {
    await open(page, "?view=no-access&status=denied");
    await expect(page.getByTestId("request-denied")).toContainText("You can ask again");
    await expect(page.getByTestId("request-access")).toBeVisible();
    await open(page, "?view=no-access&status=approved");
    await expect(page.getByTestId("request-approved")).toContainText("approved");
    await expect(page.getByTestId("request-access")).toHaveCount(0);
  });

  test("an admin-only page offers no request", async ({ page }) => {
    await open(page, "?view=no-access&admin-only=1");
    await expect(page.getByTestId("no-access")).toContainText("only for admins");
    await expect(page.getByTestId("request-access")).toHaveCount(0);
  });
});

test.describe("on a phone", () => {
  test("every tab fits the screen", async ({ page }) => {
    for (const q of ["?tab=roles", "?tab=members&member=lee", "?tab=requests", "?view=no-access"]) {
      await open(page, q);
      await expectNoHorizontalScroll(page);
    }
  });
});

test.describe("the All Members matrix", () => {
  const cell = (page: Page, uid: string, pageId: string) => page.locator(`button[data-uid="${uid}"][data-page="${pageId}"]`);

  test("legend, a role cell explains, an empty cell grants one member, a solid cell removes it", async ({ page }) => {
    await open(page, "?tab=members");
    await page.getByTestId("pa-all-members").click();
    await expect(page.getByTestId("matrix-legend")).toBeVisible();
    await expect(page.getByTestId("members-matrix").locator("tbody tr[data-member]")).toHaveCount(5);

    await expect(cell(page, "lee", "assignments")).toHaveAttribute("data-state", "role");
    await cell(page, "lee", "assignments").click();
    await expect(page.getByTestId("matrix-note")).toContainText("through the role Lead Scout");
    await expect(page.getByTestId("matrix-note-role-link")).toBeVisible();
    expect(await log(page)).toEqual([]); // explaining writes nothing

    await expect(cell(page, "mia", "assignments")).toHaveAttribute("data-state", "none");
    await cell(page, "mia", "assignments").click();
    await expect(cell(page, "mia", "assignments")).toHaveAttribute("data-state", "granted");
    await cell(page, "mia", "assignments").click();
    await expect(cell(page, "mia", "assignments")).toHaveAttribute("data-state", "none");
    expect(await log(page)).toEqual([
      { type: "member", uid: "mia", pageId: "assignments", state: "grant" },
      { type: "member", uid: "mia", pageId: "assignments", state: "default" },
    ]);
  });

  test("the role link opens that role in Roles; always-on cells are locked", async ({ page }) => {
    await open(page, "?tab=members");
    await page.getByTestId("pa-all-members").click();
    await expect(cell(page, "mia", "dashboard")).toHaveAttribute("data-state", "always");
    await cell(page, "lee", "assignments").click();
    await page.getByTestId("matrix-note-role-link").click();
    await expect(page.getByTestId("role-matrix")).toBeVisible();
  });

  test("arrow keys move between cells, and the table scrolls inside its own box (no page-level sideways scroll)", async ({ page }) => {
    await open(page, "?tab=members");
    await page.getByTestId("pa-all-members").click();
    const first = page.locator("button[data-cell]").first();
    await first.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("button[data-cell][data-r='0'][data-c='1']")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator("button[data-cell][data-r='1'][data-c='1']")).toBeFocused();
    await expectNoHorizontalScroll(page);
  });

  test("a collapsed group hides its columns, and a page search filters them", async ({ page }) => {
    await open(page, "?tab=members");
    await page.getByTestId("pa-all-members").click();
    await expect(page.locator("th[data-page='lead-scout-form']")).toBeVisible();
    await page.getByRole("button", { name: /^Forms group, expanded/ }).click();
    await expect(page.locator("th[data-page='lead-scout-form']")).toHaveCount(0);
    await page.getByRole("button", { name: /^Forms group, collapsed/ }).click();
    await page.getByTestId("mm-page-search").fill("match list");
    await expect(page.locator("th[data-page]")).toHaveCount(1);
  });
});
