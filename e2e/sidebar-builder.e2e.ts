import { expect, test, type Page } from "@playwright/test";
import type { SidebarEntry } from "../lib/sidebar/types";

// Session F: Admin Panel > Sidebar in a real browser, on /e2e/sidebar-builder (the real screen on in-memory data). The builder is drag and drop, so these tests
// drag with the mouse (the pointer sensor) and with the keyboard (the keyboard sensor), and read the result back from the page. What the database allows is
// proved by the emulator tests (lib/sidebar/store.emulator.test.ts); the drop maths is proved by lib/sidebar/dnd.test.ts. This checks the screen.

declare global {
  interface Window {
    __sb?: { type: string; entries?: SidebarEntry[] }[];
  }
}

const INDENT = 32;

async function open(page: Page) {
  await page.goto("/e2e/sidebar-builder");
  await expect(page.getByTestId("sidebar-editor")).toBeVisible();
  await page.waitForFunction(() => Array.isArray(window.__sb)); // hydrated: the fixture sets it in an effect
}

/** The rows of the builder, top to bottom, with the divider as "|". */
const order = (page: Page) => page.locator("[data-entry], [data-divider]").evaluateAll((els) => els.map((el) => (el.hasAttribute("data-divider") ? "|" : (el.getAttribute("data-entry") as string))));
const handle = (page: Page, name: string) => page.getByRole("button", { name: `Drag ${name}`, exact: true });
const row = (page: Page, id: string) => page.locator(`[data-entry="${id}"]`);

/**
 * A real mouse drag: grab the handle of `name`, move to the middle of the row `overId` (plus a sideways `dx`), and let go. The page is first scrolled so the
 * handle and the target sit around the middle of the screen: near the top or bottom edge dnd-kit auto-scrolls the page while dragging, which is right for a
 * person but would move the target away from a scripted pointer.
 */
async function drag(page: Page, name: string, overId: string, dx = 0, depthWhileDragging?: "0" | "1", foldsRows = false) {
  const grip = handle(page, name);
  const target = row(page, overId);
  await grip.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const first = (await grip.boundingBox()) as NonNullable<Awaited<ReturnType<typeof grip.boundingBox>>>;
  const aim = (await target.boundingBox()) as NonNullable<Awaited<ReturnType<typeof target.boundingBox>>>;
  const viewport = page.viewportSize()?.height ?? 800;
  // (a group folds its pages away when picked up, so the target is nearer than it looks until then: keep the handle itself mid-screen)
  if (!foldsRows) await page.evaluate((delta) => window.scrollBy(0, delta), (first.y + aim.y + aim.height) / 2 - viewport / 2);
  const from = (await grip.boundingBox()) as NonNullable<Awaited<ReturnType<typeof grip.boundingBox>>>;
  const startX = from.x + from.width / 2;
  const startY = from.y + from.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 1, startY + 6, { steps: 3 }); // past the activation distance
  // measured only now: picking up a group folds its pages away, which moves everything below it
  const to = (await target.boundingBox()) as NonNullable<Awaited<ReturnType<typeof target.boundingBox>>>;
  const endY = to.y + to.height / 2;
  await page.mouse.move(startX + dx, endY, { steps: 12 });
  await page.mouse.move(startX + dx, endY + 1, { steps: 2 }); // settle so the last over/move event lands
  // dnd-kit reports the last rendered position on release, and a dev-mode page renders a moment behind the pointer: wait until the row shows the level asked for (`data-drop-depth`, set on the dragged row only).
  if (depthWhileDragging) await expect(grip.locator("xpath=ancestor::li[@data-entry]")).toHaveAttribute("data-drop-depth", depthWhileDragging);
  await page.waitForTimeout(250);
  await page.mouse.up();
}

const pressKey = async (page: Page, key: string) => {
  await page.keyboard.press(key);
  await page.waitForTimeout(250); // dnd-kit measures and re-renders after each key; WebKit is the slowest at it
};

/** Retries until the list satisfies `check` (React re-renders a moment after the drop). */
const expectOrder = (page: Page, check: (list: string[]) => boolean | string) => expect.poll(async () => check(await order(page)), { timeout: 10_000 }).toBe(true);

test.describe("drag and drop with the mouse", () => {
  test("has a handle on every row and no up/down arrow buttons", async ({ page }) => {
    await open(page);
    await expect(handle(page, "Dashboard")).toBeVisible();
    await expect(handle(page, "Forms")).toBeVisible();
    await expect(handle(page, "Admin Panel")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Move .* (up|down)$/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Indent|Outdent/ })).toHaveCount(0);
  });

  test("dragging a page up reorders it, shows it in the preview, and turns on Save", async ({ page }) => {
    await open(page);
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await drag(page, "Dashboard", "event-selection");
    await expectOrder(page, (l) => l.slice(0, 3).join() === "dashboard,event-selection,assignments");
    await expect(page.getByTestId("sidebar-preview").locator("li").first()).toContainText("Dashboard");
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
    await expect(page.getByText("Unsaved changes")).toBeVisible();
  });

  test("dragging a page down reorders it too", async ({ page }) => {
    await open(page);
    await drag(page, "Active Events", "dashboard");
    await expectOrder(page, (l) => l.slice(0, 3).join() === "assignments,dashboard,event-selection");
  });

  test("dragging a page right puts it inside the group above, and dragging it left takes it out", async ({ page }) => {
    await open(page);
    await expect(row(page, "analytics")).toHaveAttribute("data-depth", "0");
    await drag(page, "Analytics", "analytics", INDENT, "1");
    await expect(row(page, "analytics")).toHaveAttribute("data-depth", "1");
    await expectOrder(page, (l) => l.indexOf("analytics") === l.indexOf("helper-form") + 1);
    await expect(page.getByTestId("sidebar-preview").locator("li ul").first().getByText("Analytics")).toBeVisible();
    await expect(page.getByText("Group of 8")).toBeVisible();

    await drag(page, "Analytics", "analytics", -INDENT, "0");
    await expect(row(page, "analytics")).toHaveAttribute("data-depth", "0");
    await expect(page.getByText("Group of 7")).toBeVisible();
  });

  test("dragging a page into the middle of a group", async ({ page }) => {
    await open(page);
    await drag(page, "Analytics", "team-strategy-form", INDENT, "1");
    await expect(row(page, "analytics")).toHaveAttribute("data-depth", "1");
    await expectOrder(page, (l) => l.indexOf("analytics") > l.indexOf("pit-scout-form") && l.indexOf("analytics") < l.indexOf("helper-form"));
  });

  test("dragging a group moves its pages with it", async ({ page }) => {
    await open(page);
    const before = await order(page);
    const pages = before.slice(before.indexOf("forms") + 1, before.indexOf("forms") + 8);
    await drag(page, "Forms", "practice-scouting", 0, undefined, true);
    await expectOrder(page, (l) => l.indexOf("forms") > l.indexOf("analytics") && l.slice(l.indexOf("forms") + 1, l.indexOf("forms") + 8).join() === pages.join());
    await expect(row(page, "helper-form")).toHaveAttribute("data-depth", "1");
  });

  test("dragging across the divider moves a page into the bottom block, and back", async ({ page }) => {
    await open(page);
    await drag(page, "People", "changelog");
    await expectOrder(page, (l) => l.indexOf("people") > l.indexOf("|"));
    await drag(page, "People", "team-management");
    await expectOrder(page, (l) => l.indexOf("people") < l.indexOf("|"));
  });

  test("Save hands over the complete layout, and the screen is clean again", async ({ page }) => {
    await open(page);
    await drag(page, "Dashboard", "event-selection");
    await expectOrder(page, (l) => l[0] === "dashboard");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    const saves = (await page.evaluate(() => window.__sb ?? [])).filter((x) => x.type === "save");
    expect(saves).toHaveLength(1);
    const entries = saves[0].entries ?? [];
    expect(entries.find((e) => e.id === "dashboard")).toMatchObject({ parent: null, order: 0 });
    expect(entries.find((e) => e.id === "event-selection")).toMatchObject({ parent: null, order: 1 });
  });

  test("a new group takes dragged pages", async ({ page }) => {
    await open(page);
    await page.getByPlaceholder(/Group name/).fill("Strategy");
    await page.getByRole("button", { name: "Create group" }).click();
    const group = page.locator("[data-entry]").filter({ hasText: "Empty group" }).first();
    await expect(group).toContainText("Empty group");
    const groupId = (await group.getAttribute("data-entry")) as string;
    // the new group is last in the main list; drag the page above it onto it and a little right
    await drag(page, "Team Management", groupId, INDENT, "1");
    await expect(row(page, "team-management")).toHaveAttribute("data-depth", "1");
    await expect(row(page, groupId)).toContainText("Group of 1");
  });
});

test.describe("drag and drop with the keyboard", () => {
  test("handle, Space, arrow keys, Space moves a row", async ({ page }) => {
    await open(page);
    await handle(page, "Dashboard").focus();
    await pressKey(page, "Space");
    await pressKey(page, "ArrowUp");
    await pressKey(page, "ArrowUp");
    await pressKey(page, "Space");
    await expectOrder(page, (l) => l.slice(0, 3).join() === "dashboard,event-selection,assignments");
  });

  test("Right and Left choose the level before dropping", async ({ page }) => {
    await open(page);
    await handle(page, "Analytics").focus();
    await pressKey(page, "Space");
    await pressKey(page, "ArrowRight");
    await pressKey(page, "Space");
    await expect(row(page, "analytics")).toHaveAttribute("data-depth", "1");
  });

  test("Escape cancels and changes nothing", async ({ page }) => {
    await open(page);
    const before = await order(page);
    await handle(page, "Dashboard").focus();
    await pressKey(page, "Space");
    await pressKey(page, "ArrowUp");
    await pressKey(page, "Escape");
    await expectOrder(page, (l) => l.join() === before.join());
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  });
});

test.describe("everything else on the screen", () => {
  test("Location in the edit dialog moves a page without dragging", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Rename, change the icon or move People" }).click();
    await page.getByRole("combobox", { name: /Location/ }).click();
    await page.getByRole("option", { name: /Bottom block/ }).click();
    await page.getByRole("button", { name: "Apply" }).click();
    await expectOrder(page, (l) => l.indexOf("people") > l.indexOf("|"));
  });

  test("renaming, hiding and resetting still work, and the Admin Panel cannot be hidden", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Rename, change the icon or move Dashboard" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Home");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(row(page, "dashboard")).toContainText("Home");
    await expect(row(page, "dashboard")).toContainText("Renamed (was Dashboard)");
    await page.getByRole("button", { name: "Reset Home to its default" }).click();
    await expect(row(page, "dashboard")).not.toContainText("Renamed");
    await page.getByRole("switch", { name: "Show People in the sidebar" }).click();
    await expect(row(page, "people")).toContainText("Hidden from the sidebar");
    await expect(page.getByRole("switch", { name: "Show Admin Panel in the sidebar" })).toBeDisabled();
  });

  test("the sync card sends a saved layout and loads the other program's layout, each after a check where it replaces something", async ({ page }) => {
    await open(page);
    const send = page.getByRole("button", { name: "Send this layout to FTC" });
    const pull = page.getByRole("button", { name: "Copy FTC's layout here" });
    await expect(send).toBeEnabled();
    await drag(page, "Dashboard", "event-selection");
    await expect(send).toBeDisabled(); // unsaved changes are not sent
    await expect(page.getByText("Save your changes first to send them.")).toBeVisible();
    await pull.click(); // unsaved changes would be dropped: asks first
    await expect(page.getByRole("heading", { name: "Replace your unsaved changes?" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    expect((await page.evaluate(() => window.__sb ?? [])).filter((x) => x.type === "pull")).toHaveLength(0);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await send.click();
    await expect(page.getByRole("heading", { name: "Replace the FTC sidebar?" })).toBeVisible();
    await page.getByRole("button", { name: "Send to FTC" }).click();
    await pull.click(); // nothing unsaved: no question
    const kinds = (await page.evaluate(() => window.__sb ?? [])).map((x) => x.type);
    expect(kinds).toEqual(["save", "send", "pull"]);
  });

  test("does not scroll the page sideways", async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });
});
