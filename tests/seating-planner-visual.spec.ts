import { expect, test, type Locator, type Page } from "@playwright/test";
import { findDuplicateTablePosition } from "../seating-chart-app/src/lib/tablePlacement";
import { planSeatLabels } from "../seating-chart-app/src/lib/seatLabels";

const APP_URL = "http://127.0.0.1:45174/?v=opposing-100-regression";
const MOCK_SUPABASE_URL = "http://mock-supabase.test";

type Guest = {
  id: string;
  fullName: string;
  tableId: string;
  chairIndex: number | null;
  weddingGuestId?: string;
  groupId?: string;
  isPrimary?: boolean;
  isPlusOne?: boolean;
  isChild?: boolean;
  mealChoice?: string | null;
  dietaryNotes?: string | null;
};

type TableShape = {
  type: "table";
  id: string;
  number: number;
  x: number;
  y: number;
  shape: "rectangle";
  radius: number;
  width: number;
  height: number;
  seatingStyle: "opposing" | "all";
  topSeats: number;
  bottomSeats: number;
  capacity: number;
  rotation?: number;
  locked?: boolean;
  seatingLocked?: boolean;
  linkedEdges?: Record<string, unknown>;
  linkedSeatingMerged?: boolean;
};

type VenueShape = {
  type: "venue";
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  stroke: string;
  strokeWidth: number;
};

type VenueData = {
  shapes: Array<TableShape | VenueShape | Record<string, unknown>>;
  guests: Guest[];
  eventTitle: string;
  tableCounter: number;
};

const TABLE_POSITIONS = [
  { x: 160, y: 230 },
  { x: 430, y: 250 },
  { x: 700, y: 225 },
  { x: 970, y: 255 },
  { x: 1240, y: 235 },
  { x: 160, y: 605 },
  { x: 430, y: 580 },
  { x: 700, y: 615 },
  { x: 970, y: 585 },
  { x: 1240, y: 610 },
];

function buildVenueData(): VenueData {
  const venue: VenueShape = {
    type: "venue",
    id: "venue-space-regression",
    title: "Venue Space",
    x: 0,
    y: 0,
    width: 1400,
    height: 840,
    color: "rgba(0, 0, 0, 0)",
    stroke: "#333333",
    strokeWidth: 2,
  };

  const tables: TableShape[] = TABLE_POSITIONS.map((position, index) => ({
    type: "table",
    id: `table-${index + 1}`,
    number: index + 1,
    x: position.x,
    y: position.y,
    shape: "rectangle",
    radius: 100,
    width: 200,
    height: 90,
    seatingStyle: "opposing",
    topSeats: index === 7 ? 4 : 5,
    bottomSeats: index === 7 ? 6 : 5,
    capacity: 10,
    rotation: index === 8 ? 45 : 0,
  }));

  const guests: Guest[] = [];
  let guestNumber = 1;
  for (const table of tables) {
    const count = table.number === 1 ? 6 : 10;
    for (let chairIndex = 0; chairIndex < count; chairIndex += 1) {
      guests.push({
        id: `guest-${String(guestNumber).padStart(3, "0")}`,
        fullName: `Guest ${String(guestNumber).padStart(3, "0")}`,
        tableId: table.id,
        chairIndex,
      });
      guestNumber += 1;
    }
  }

  while (guestNumber <= 100) {
    guests.push({
      id: `guest-${String(guestNumber).padStart(3, "0")}`,
      fullName: `Guest ${String(guestNumber).padStart(3, "0")}`,
      tableId: "",
      chairIndex: null,
      weddingGuestId: `accepted-${guestNumber}`,
      groupId: "party-100",
      isPrimary: guestNumber === 97,
      isPlusOne: guestNumber > 97,
      isChild: false,
      mealChoice: "Dinner",
      dietaryNotes: null,
    });
    guestNumber += 1;
  }

  return {
    shapes: [venue, ...tables],
    guests,
    eventTitle: "Opposing Tables · 100 Guests",
    tableCounter: 11,
  };
}

async function installMockApi(page: Page, options: { admin?: boolean } = {}) {
  let venueData = buildVenueData();
  const isAdmin = options.admin !== false;

  await page.addInitScript(({ admin }) => {
    if (admin) {
      window.localStorage.setItem("km_access_token", "visual-regression-admin");
    }
    window.localStorage.setItem("seating-chart.canvas-tips-dismissed", "true");
    let seed = 42;
    Math.random = () => {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      return seed / 4_294_967_296;
    };
  }, { admin: isAdmin });

  await page.route("**/site.config.json", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        supabase: { url: MOCK_SUPABASE_URL, anonKey: "visual-regression-key" },
      }),
    });
  });

  await page.route(`${MOCK_SUPABASE_URL}/rest/v1/rpc/get_access_session`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ accessLevel: isAdmin ? "admin" : "none" }),
    });
  });

  await page.route(`${MOCK_SUPABASE_URL}/functions/v1/seating-chart-api/guests`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        parties: [
          {
            groupId: "party-100",
            guests: [97, 98, 99, 100].map((number) => ({
              weddingGuestId: `accepted-${number}`,
              fullName: `Guest ${number}`,
              isPrimary: number === 97,
              isPlusOne: number > 97,
              isChild: false,
              mealChoice: "Dinner",
              dietaryNotes: null,
            })),
          },
        ],
      }),
    });
  });

  await page.route(`${MOCK_SUPABASE_URL}/functions/v1/seating-chart-api/venue?**`, async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as { venueData: VenueData };
      venueData = structuredClone(body.venueData);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ success: true, updatedAt: "2026-08-16T08:00:00.000Z" }),
      });
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        slug: "opposing-100-regression",
        venueData,
        updatedAt: "2026-08-16T08:00:00.000Z",
        hasEditPin: true,
        hasViewPin: false,
        viewPinRequired: false,
      }),
    });
  });

  return {
    current: () => venueData,
  };
}

async function openPlanner(
  page: Page,
  options: { hideToasts?: boolean; expectCanvas?: boolean; admin?: boolean } = {},
) {
  const state = await installMockApi(page, { admin: options.admin });
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Seating Chart" })).toBeVisible();
  if ((page.viewportSize()?.width ?? 1280) < 1024) {
    await expect(page.getByText("96 seated", { exact: true }).first()).toBeVisible();
  } else {
    await expect(
      page.getByRole("status", { name: /100 guests total, 96 seated, 4 unassigned, 4 open seats/i }),
    ).toBeVisible();
  }
  await expect(page.getByText("10 Tables", { exact: true })).toBeVisible();
  if (options.expectCanvas !== false) {
    await expect(page.locator(".konvajs-content")).toBeVisible();
  }
  const toastRule = options.hideToasts === false
    ? ""
    : "[data-radix-toast-viewport], [data-sonner-toaster] { display: none !important; }";
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        caret-color: transparent !important;
      }
      ${toastRule}
    `,
  });
  await page.waitForTimeout(500);
  return state;
}

function tableBounds(table: TableShape) {
  const radians = ((table.rotation ?? 0) * Math.PI) / 180;
  const extentX = Math.abs(Math.cos(radians)) * table.width / 2
    + Math.abs(Math.sin(radians)) * table.height / 2;
  const extentY = Math.abs(Math.sin(radians)) * table.width / 2
    + Math.abs(Math.cos(radians)) * table.height / 2;
  return {
    left: table.x - extentX,
    right: table.x + extentX,
    top: table.y - extentY,
    bottom: table.y + extentY,
  };
}

function boundsOverlap(
  left: ReturnType<typeof tableBounds>,
  right: ReturnType<typeof tableBounds>,
) {
  return left.left < right.right
    && left.right > right.left
    && left.top < right.bottom
    && left.bottom > right.top;
}

function makeTable(overrides: Partial<TableShape> & Pick<TableShape, "id" | "number" | "x" | "y">): TableShape {
  return {
    type: "table",
    shape: "rectangle",
    radius: 50,
    width: 100,
    height: 60,
    seatingStyle: "opposing",
    topSeats: 3,
    bottomSeats: 3,
    capacity: 6,
    rotation: 0,
    ...overrides,
  };
}

test.describe("duplicate table placement geometry", () => {
  test("finds an off-axis opening inside the venue", () => {
    const source = makeTable({ id: "source", number: 1, x: 250, y: 250 });
    const horizontalBlocker = makeTable({
      id: "horizontal",
      number: 2,
      x: 250,
      y: 250,
      width: 500,
      height: 100,
    });
    const verticalBlocker = makeTable({
      id: "vertical",
      number: 3,
      x: 250,
      y: 250,
      width: 100,
      height: 500,
    });
    const venue: VenueShape = {
      type: "venue",
      id: "venue",
      title: "Venue Space",
      x: 0,
      y: 0,
      width: 500,
      height: 500,
      color: "transparent",
      stroke: "black",
      strokeWidth: 1,
    };

    const position = findDuplicateTablePosition(
      source,
      [source, horizontalBlocker, verticalBlocker],
      venue,
    );
    const duplicate = { ...source, ...position };
    const duplicateBounds = tableBounds(duplicate);
    expect(position.x).not.toBe(source.x);
    expect(position.y).not.toBe(source.y);
    expect(duplicateBounds.left).toBeGreaterThanOrEqual(venue.x);
    expect(duplicateBounds.right).toBeLessThanOrEqual(venue.x + venue.width);
    expect(duplicateBounds.top).toBeGreaterThanOrEqual(venue.y);
    expect(duplicateBounds.bottom).toBeLessThanOrEqual(venue.y + venue.height);
    expect(
      [source, horizontalBlocker, verticalBlocker]
        .every((table) => !boundsOverlap(duplicateBounds, tableBounds(table))),
    ).toBe(true);
  });

  test("finds a non-overlapping position without a venue", () => {
    const source = makeTable({ id: "source", number: 1, x: 100, y: 100 });
    const position = findDuplicateTablePosition(source, [source]);
    const duplicate = { ...source, ...position };
    expect(boundsOverlap(tableBounds(source), tableBounds(duplicate))).toBe(false);
  });

  test("uses a checked non-overlapping outside fallback for a packed venue", () => {
    const source = makeTable({
      id: "source",
      number: 1,
      x: 150,
      y: 150,
      radius: 130,
      width: 260,
      height: 260,
    });
    const venue: VenueShape = {
      type: "venue",
      id: "venue",
      title: "Venue Space",
      x: 0,
      y: 0,
      width: 300,
      height: 300,
      color: "transparent",
      stroke: "black",
      strokeWidth: 1,
    };
    const position = findDuplicateTablePosition(source, [source], venue);
    const duplicate = { ...source, ...position };
    expect(tableBounds(duplicate).left).toBeGreaterThanOrEqual(venue.x + venue.width);
    expect(boundsOverlap(tableBounds(source), tableBounds(duplicate))).toBe(false);
  });
});

test.describe("progressive seat labels", () => {
  test("removes ambiguous initials from the fitted overview", () => {
    const venueData = buildVenueData();
    const tables = venueData.shapes.filter(
      (shape): shape is TableShape => shape.type === "table",
    );

    expect(planSeatLabels(tables, venueData.guests, 0.59)).toEqual([]);

    const detailed = planSeatLabels(tables, venueData.guests, 1.25);
    expect(detailed.length).toBeGreaterThan(0);
    expect(detailed.every((label) => !/^[A-Z]{1,2}$/.test(label.text))).toBe(true);
    expect(new Set(detailed.map((label) => label.text)).size).toBe(detailed.length);
  });
});

function canvasShell(page: Page): Locator {
  return page.getByRole("region", { name: /Interactive seating layout/i });
}

async function worldToPage(page: Page, x: number, y: number) {
  const stage = page.locator("[data-canvas-stage]");
  const box = await stage.boundingBox();
  if (!box) throw new Error("Canvas did not have a bounding box");
  const positionX = Number(await stage.getAttribute("data-stage-position-x"));
  const positionY = Number(await stage.getAttribute("data-stage-position-y"));
  const scale = Number(await stage.getAttribute("data-stage-scale"));
  return {
    x: box.x + positionX + x * scale,
    y: box.y + positionY + y * scale,
    scale,
  };
}

async function clickWorld(page: Page, x: number, y: number, options?: { modifiers?: Array<"Control" | "Meta"> }) {
  const point = await worldToPage(page, x, y);
  for (const modifier of options?.modifiers ?? []) await page.keyboard.down(modifier);
  await page.mouse.click(point.x, point.y);
  for (const modifier of [...(options?.modifiers ?? [])].reverse()) await page.keyboard.up(modifier);
}

async function dragWorld(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const start = await worldToPage(page, from.x, from.y);
  const end = await worldToPage(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
}

async function dragLocator(page: Page, source: Locator, target: Locator) {
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("Drag source or target had no bounding box");
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(200);
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 15 });
  await page.mouse.up();
}

test.describe("Seating planner — 100 guest opposing-rectangle visual regression", () => {
  test.use({
    viewport: { width: 1600, height: 1000 },
    colorScheme: "light",
  });

  test("renders the complete editor and deterministic 100-guest arrangement", async ({ page }) => {
    await openPlanner(page);

    await expect(page.getByRole("button", { name: "Add Table" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add custom element" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Lock event space" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add background image" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sync Accepted Guests" })).toBeVisible();
    await expect(page.getByLabel("Show canvas tips")).toBeVisible();

    await expect(page).toHaveScreenshot("01-opposing-100-editor.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });

    await page.getByLabel("Show canvas tips").click();
    await expect(page.getByRole("region", { name: "Canvas tips" })).toBeVisible();
    await expect(canvasShell(page)).toHaveScreenshot("02-canvas-editing-tips.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });
    await page.getByLabel("Hide canvas tips").click();
  });

  test("keeps view-only help limited to navigation and seat interpretation", async ({ page }) => {
    const state = await openPlanner(page, { admin: false });
    await expect(page.getByText("View only", { exact: true })).toBeVisible();

    await page.getByLabel("Show canvas tips").click();
    const tips = page.getByRole("region", { name: "Canvas tips" });
    await expect(tips).toContainText("Alt + Mouse");
    await expect(tips).toContainText("Scroll");
    await expect(tips).not.toContainText("multi-select");
    await expect(tips).not.toContainText("rename elements");
    await expect(tips).not.toContainText("Delete");

    await page.getByRole("searchbox", { name: "Find a guest or table" }).fill("Guest 055");
    await page.getByRole("button", { name: "Show Guest 055 on chart" }).click();
    await page.keyboard.press("Delete");
    await page.waitForTimeout(800);
    expect(state.current().shapes.filter((shape) => shape.type === "table")).toHaveLength(10);
  });

  test("searches, filters, collapses, and jumps from guests to labeled table controls", async ({ page }) => {
    const state = await openPlanner(page);

    const search = page.getByRole("searchbox", { name: "Find a guest or table" });
    await search.fill("Guest 055");
    const jumpToGuest = page.getByRole("button", { name: "Show Guest 055 on chart" });
    await expect(jumpToGuest).toBeVisible();
    await jumpToGuest.click();

    const inspector = page.locator("[data-table-inspector]");
    await expect(inspector.getByRole("heading", { name: "Table 6" })).toBeVisible();
    await expect(inspector.getByRole("button", { name: "Duplicate table" })).toBeVisible();
    await expect(inspector.getByRole("button", { name: "Lock position" })).toBeVisible();
    await expect(inspector.getByRole("button", { name: "Delete table" })).toBeVisible();
    await expect.poll(async () => {
      const point = await worldToPage(page, 160, 605);
      const box = await canvasShell(page).boundingBox();
      if (!box) return false;
      return (
        point.x >= box.x + box.width * 0.3 &&
        point.x <= box.x + box.width * 0.7 &&
        point.y >= box.y + box.height * 0.3 &&
        point.y <= box.y + box.height * 0.7
      );
    }).toBe(true);

    await search.focus();
    await page.keyboard.press("Delete");
    await page.waitForTimeout(800);
    expect(state.current().shapes.filter((shape) => shape.type === "table")).toHaveLength(10);

    page.once("dialog", (dialog) => dialog.accept("11"));
    await inspector.getByRole("button", { name: "Rename table" }).click();
    await expect(inspector.getByRole("heading", { name: "Table 11" })).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept("6"));
    await inspector.getByRole("button", { name: "Rename table" }).click();
    await expect(inspector.getByRole("heading", { name: "Table 6" })).toBeVisible();

    await page.getByRole("button", { name: "Clear search" }).click();
    await page.getByRole("button", { name: "Open seats", pressed: false }).click();
    await expect(page.getByText("Table 1", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Table 2", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "All", pressed: false }).click();
    const tableOneToggle = page.getByRole("button", { name: /Table 1.*6\/10/i }).first();
    await expect(tableOneToggle).toHaveAttribute("aria-expanded", "false");
    await tableOneToggle.click();
    await expect(tableOneToggle).toHaveAttribute("aria-expanded", "true");

    await expect(page).toHaveScreenshot("14-search-filter-table-inspector.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });

    await search.fill("Guest 097");
    await expect(page.getByRole("button", { name: "Show Guest 097 on chart" })).toHaveCount(0);

    // Renaming into the next generated number must advance allocation so a
    // later duplicate cannot silently create two tables with one label.
    page.once("dialog", (dialog) => dialog.accept("11"));
    await inspector.getByRole("button", { name: "Rename table" }).click();
    await inspector.getByRole("button", { name: "Duplicate table" }).click();
    await expect.poll(() => {
      const numbers = state.current().shapes
        .filter((shape): shape is TableShape => shape.type === "table" && "number" in shape)
        .map((table) => table.number);
      return {
        hasTwelve: numbers.includes(12),
        unique: new Set(numbers).size === numbers.length,
      };
    }).toEqual({ hasTwelve: true, unique: true });
  });

  test("edits opposing-side counts and guards occupied seats", async ({ page }) => {
    const state = await openPlanner(page);
    await clickWorld(page, 160, 230);

    const inspector = page.locator("[data-table-inspector]");
    await expect(inspector.getByRole("heading", { name: "Table 1" })).toBeVisible();
    await expect(inspector.getByText("6 of 10 seats filled")).toBeVisible();

    await expect(canvasShell(page)).toHaveScreenshot("03-selected-opposing-table-tools.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });

    // Opposing tables expose labeled settings, duplicate, and position-lock controls.
    await inspector.getByRole("button", { name: "Seating layout" }).click();
    const dialog = page.getByRole("dialog", { name: "Table 1 Seating Layout" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Opposing Sides Only" })).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByRole("button", { name: "All Sides" })).toHaveAttribute("aria-pressed", "false");
    await expect(dialog.getByText("10 seats total")).toBeVisible();
    await expect(dialog).toHaveScreenshot("04-opposing-seat-layout-modal.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });

    await dialog.getByRole("button", { name: "Decrease seats on top side" }).click();
    await expect(dialog.getByText("10 seats total")).toBeVisible();
    await dialog.getByRole("button", { name: "Increase seats on top side" }).click();
    await expect(dialog.getByText("11 seats total")).toBeVisible();

    await dialog.getByRole("button", { name: "Decrease seats on bottom side" }).click();
    await expect(dialog.getByText("10 seats total")).toBeVisible();

    await dialog.getByRole("button", { name: "All Sides" }).click();
    await expect(dialog).toContainText("four sides");
    await dialog.getByRole("button", { name: "Done" }).click();
    await inspector.getByRole("button", { name: "Seating layout" }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Opposing Sides Only" }).click();
    await dialog.getByRole("button", { name: "Link touching edge" }).click();
    await dialog.getByRole("button", { name: "Done" }).click();

    // Duplicate, lock/unlock, and resize remain available through the
    // inspector plus direct-manipulation handles.
    await inspector.getByRole("button", { name: "Duplicate table" }).click();
    await expect(page.getByText("11 Tables", { exact: true })).toBeVisible();
    await expect.poll(
      () => state.current().shapes.filter((shape) => shape.type === "table").length,
      { timeout: 6_000 },
    ).toBe(11);
    const getDuplicate = () => state.current().shapes
      .find((shape): shape is TableShape => shape.type === "table" && "number" in shape && shape.number === 11);
    const initialDuplicate = getDuplicate();
    if (!initialDuplicate) throw new Error("Duplicate control did not create Table 11");
    const duplicateBounds = tableBounds(initialDuplicate);
    const originalTables = state.current().shapes.filter(
      (item): item is TableShape => item.type === "table" && "number" in item && item.number !== 11,
    );
    expect(
      originalTables.every((table) => !boundsOverlap(duplicateBounds, tableBounds(table))),
      `duplicate ${JSON.stringify(initialDuplicate)} overlaps ${JSON.stringify(originalTables.filter((table) => boundsOverlap(duplicateBounds, tableBounds(table))).map((table) => ({ number: table.number, bounds: tableBounds(table) })))}`,
    ).toBe(true);
    const venue = state.current().shapes.find(
      (item): item is VenueShape => item.type === "venue" && "title" in item && item.title === "Venue Space",
    );
    if (!venue) throw new Error("Venue Space disappeared");
    expect(duplicateBounds.left).toBeGreaterThanOrEqual(venue.x);
    expect(duplicateBounds.right).toBeLessThanOrEqual(venue.x + venue.width);
    expect(duplicateBounds.top).toBeGreaterThanOrEqual(venue.y);
    expect(duplicateBounds.bottom).toBeLessThanOrEqual(venue.y + venue.height);
    const getLockTable = () => state.current().shapes
      .find((shape): shape is TableShape => shape.type === "table" && "number" in shape && shape.number === 8);
    const lockTable = getLockTable();
    if (!lockTable) throw new Error("Table 8 disappeared");

    const sidebarSearch = page.getByRole("searchbox", { name: "Find a guest or table" });
    await sidebarSearch.fill("Table 8");
    await page.getByRole("button", { name: "Show Table 8 on chart" }).click();
    await expect(inspector.getByRole("heading", { name: "Table 8" })).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).click();
    await inspector.getByRole("button", { name: "Lock position" }).click();
    await expect.poll(() => getLockTable()?.locked, { timeout: 6_000 }).toBe(true);
    await inspector.getByRole("button", { name: "Unlock position" }).click();
    await expect.poll(() => getLockTable()?.locked, { timeout: 6_000 }).toBe(false);

    await clickWorld(page, lockTable.x, lockTable.y);
    await dragWorld(
      page,
      { x: lockTable.x + 100, y: lockTable.y },
      { x: lockTable.x + 160, y: lockTable.y },
    );
    await expect.poll(() => (getLockTable()?.width ?? 0) > 220, { timeout: 6_000 }).toBe(true);

    // The enlarged, separated rotation handle must remain directly usable
    // even with occupied seats and persistent labels around the table.
    const resizedTable = getLockTable();
    if (!resizedTable) throw new Error("Table 8 disappeared after resize");
    const { scale } = await worldToPage(page, resizedTable.x, resizedTable.y);
    // Konva keeps Transformer.rotateAnchorOffset screen-relative, so convert
    // its 80px offset back to the chart's fitted world coordinate system.
    const rotationHandleY = resizedTable.y - resizedTable.height / 2 - 8 - 5 - 8 - 80 / scale;
    await dragWorld(
      page,
      { x: resizedTable.x, y: rotationHandleY },
      { x: resizedTable.x + 170, y: resizedTable.y },
    );
    await expect.poll(
      () => Math.round(getLockTable()?.rotation ?? 0),
      { timeout: 6_000 },
    ).toBe(90);

    await expect(canvasShell(page)).toHaveScreenshot("05-duplicated-resized-rotated-table.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.015,
    });

    await sidebarSearch.fill("Table 11");
    await page.getByRole("button", { name: "Show Table 11 on chart" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await inspector.getByRole("button", { name: "Delete table" }).click();
    await expect(page.getByText("10 Tables", { exact: true })).toBeVisible();
    await expect(inspector).toHaveCount(0);
  });

  test("multi-selects tables and exercises every alignment action", async ({ page }) => {
    const state = await openPlanner(page);
    await clickWorld(page, 160, 230);
    await clickWorld(page, 430, 250, { modifiers: ["Control"] });
    await clickWorld(page, 700, 225, { modifiers: ["Control"] });

    const alignments = [
      "Align left edges",
      "Align horizontal centers",
      "Align right edges",
      "Align top edges",
      "Align vertical centers",
      "Align bottom edges",
    ];
    for (const label of alignments) {
      const button = page.getByRole("button", { name: label });
      await expect(button).toBeEnabled();
      await button.click();
    }

    await expect(page.getByText("3 tables", { exact: true })).toBeVisible();
    await expect(canvasShell(page)).toHaveScreenshot("06-multi-table-alignment-toolbar.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });

    await page.getByRole("button", { name: "Clear table selection" }).click();
    await expect(page.getByRole("button", { name: "Align left edges" })).toHaveCount(0);
    await expect.poll(() => {
      const selected = state.current().shapes
        .filter((shape): shape is TableShape => shape.type === "table")
        .filter((table) => ["table-1", "table-2", "table-3"].includes(table.id));
      return new Set(selected.map((table) => table.y)).size;
    }, { timeout: 6_000 }).toBe(1);
    expect(state.current().shapes.filter((shape) => shape.type === "table")).toHaveLength(10);
  });

  test("links, merges, moves, and unlinks touching rectangular tables", async ({ page }) => {
    await openPlanner(page);
    await dragWorld(page, { x: 430, y: 250 }, { x: 360, y: 230 });
    await clickWorld(page, 160, 230);
    const inspector = page.locator("[data-table-inspector]");
    await inspector.getByRole("button", { name: "Seating layout" }).click();

    const dialog = page.getByRole("dialog", { name: "Table 1 Seating Layout" });
    await dialog.getByRole("button", { name: "Link touching edge" }).click();
    await expect(dialog.getByText(/right edge.*Table 2/i)).toBeVisible();
    await dialog.getByRole("switch", { name: "Merge linked tables for seating" }).click();
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText("Table 1 · linked with 2", { exact: true })).toBeVisible();

    await expect(page).toHaveScreenshot("07-linked-merged-opposing-tables.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });

    await inspector.getByRole("button", { name: "Seating layout" }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /Unlink/ }).click();
    await expect(dialog.getByText(/edge.*Table 2/i)).toHaveCount(0);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText("Table 1 · linked with 2", { exact: true })).toHaveCount(0);
  });

  test("assigns, edits, removes, drags, syncs, and locks guest seating", async ({ page }) => {
    await openPlanner(page);

    // Empty bottom-side seat 10 on Table 1.
    await clickWorld(page, 160 + 70.4, 230 + 58);
    const assignmentDialog = page.getByRole("dialog", { name: "Assign Guest" });
    await expect(assignmentDialog).toBeVisible();
    await expect(assignmentDialog).toHaveScreenshot("08-assign-empty-seat.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });
    await assignmentDialog.getByLabel("Full Name").fill("Regression Guest");
    await assignmentDialog.getByRole("button", { name: "Save Guest" }).click();
    await expect(page.getByRole("status", { name: /101 guests total/i })).toBeVisible();

    await clickWorld(page, 160 + 70.4, 230 + 58);
    const editDialog = page.getByRole("dialog", { name: "Edit Guest" });
    await editDialog.getByLabel("Full Name").fill("Regression Guest Renamed");
    await editDialog.getByRole("button", { name: "Remove Guest" }).click();
    await expect(page.getByRole("status", { name: /100 guests total/i })).toBeVisible();

    // Drag the four-person unassigned party onto Table 1's four empty seats.
    const partyHandle = page.getByRole("button", { name: /Drag Guest 097's Party \(4\)/ });
    const tableOneHeading = page.getByText("Table 1", { exact: true }).first();
    await dragLocator(page, partyHandle, tableOneHeading);
    await expect(partyHandle).toHaveCount(0);
    await expect(page.getByText("10/10", { exact: true }).first()).toBeVisible();

    const seatingLock = page.getByRole("button", { name: "Lock this table's seating" }).first();
    await seatingLock.click();
    await expect(page.getByRole("button", { name: "Unlock this table's seating" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Drag Guest 001" })).toHaveCount(0);

    await page.getByRole("button", { name: "Sync Accepted Guests" }).click();
    await expect(page.getByText("Guest List Synced")).toHaveCount(1);
    await expect(page.getByRole("status", { name: /100 guests total/i })).toBeVisible();

    await expect(page).toHaveScreenshot("09-seating-locked-after-party-drop.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });
  });

  test("keeps editing notifications outside the desktop canvas", async ({ page }) => {
    await openPlanner(page, { hideToasts: false });
    await page.getByRole("button", { name: "Sync Accepted Guests" }).click();
    await expect(page.getByText("Guest List Synced", { exact: true })).toBeVisible();

    const toastBox = await page
      .getByText("Guest List Synced")
      .locator("xpath=ancestor::*[@data-state='open'][1]")
      .boundingBox();
    const canvasBox = await canvasShell(page).boundingBox();
    if (!toastBox || !canvasBox) throw new Error("Toast viewport or canvas was not measurable");
    expect(toastBox.x + toastBox.width).toBeLessThanOrEqual(canvasBox.x);

    await expect(page).toHaveScreenshot("13-sidebar-toast-placement.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });
  });

  test("edits custom elements, venue lock, background placement, opacity, lock, replace, and remove", async ({ page }) => {
    const state = await openPlanner(page);

    await page.getByRole("button", { name: "Add Table" }).click();
    await page.getByRole("menuitem", { name: "Rectangular Table" }).click();
    await expect(page.getByText("11 Tables", { exact: true })).toBeVisible();
    await expect.poll(
      () => state.current().shapes.filter((shape) => shape.type === "table").length,
      { timeout: 6_000 },
    ).toBe(11);
    const createdTable = state.current().shapes
      .filter((shape): shape is TableShape => shape.type === "table")
      .find((table) => table.number === 11);
    if (!createdTable) throw new Error("The rectangular-table command did not create Table 11");
    await clickWorld(page, createdTable.x, createdTable.y);
    await page.keyboard.press("Delete");
    await expect(page.getByText("10 Tables", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Add custom element" }).click();
    await expect.poll(
      () => state.current().shapes.some((shape) => shape.type === "venue" && "title" in shape && shape.title === "New Element"),
      { timeout: 6_000 },
    ).toBe(true);
    const customElement = state.current().shapes.find(
      (shape): shape is VenueShape => shape.type === "venue" && "title" in shape && shape.title === "New Element",
    );
    if (!customElement) throw new Error("The custom-element command did not create an element");
    const candidatePoints = [
      { x: customElement.x + 10, y: customElement.y + 10 },
      { x: customElement.x + customElement.width - 10, y: customElement.y + 10 },
      { x: customElement.x + 10, y: customElement.y + customElement.height - 10 },
      { x: customElement.x + customElement.width - 10, y: customElement.y + customElement.height - 10 },
      { x: customElement.x + customElement.width / 2, y: customElement.y + customElement.height / 2 },
    ];
    const renamePoint = candidatePoints.find((point) =>
      TABLE_POSITIONS.every((table) => Math.abs(point.x - table.x) > 115 || Math.abs(point.y - table.y) > 70),
    ) ?? candidatePoints[0];
    const center = await worldToPage(page, renamePoint.x, renamePoint.y);
    await page.mouse.dblclick(center.x, center.y);
    const renameDialog = page.getByRole("dialog", { name: "Rename Element" });
    await expect(renameDialog).toBeVisible();
    await renameDialog.getByLabel("Title").fill("Dance Floor");
    await expect(renameDialog).toHaveScreenshot("10-rename-custom-element.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });
    await renameDialog.getByRole("button", { name: "Save changes" }).click();
    await expect(renameDialog).toBeHidden();
    await page.keyboard.press("Delete");

    await page.getByRole("button", { name: "Lock event space" }).click();
    await expect(page.getByRole("button", { name: "Unlock event space" })).toBeVisible();
    await page.getByRole("button", { name: "Unlock event space" }).click();
    await expect(page.getByRole("button", { name: "Lock event space" })).toBeVisible();

    const floorplanSvg = Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="1400" height="840">
        <rect width="1400" height="840" fill="#f5f1e5"/>
        <path d="M70 70H1330V770H70Z M700 70V770 M70 420H1330" fill="none" stroke="#7a9a1f" stroke-width="12" stroke-dasharray="24 18"/>
        <circle cx="700" cy="420" r="170" fill="#eef3dc" stroke="#2e3a1c" stroke-width="8"/>
      </svg>
    `);
    const backgroundInput = page.locator('input[type="file"][accept="image/*"]');
    await backgroundInput.setInputFiles({
      name: "floorplan.svg",
      mimeType: "image/svg+xml",
      buffer: floorplanSvg,
    });
    await expect(page.getByRole("button", { name: "Background image settings" })).toBeVisible();
    await page.getByRole("button", { name: "Background image settings" }).click();
    await expect(page.getByText("Background Image", { exact: true })).toBeVisible();
    const opacitySlider = page.getByRole("slider");
    await opacitySlider.press("Home");
    for (let index = 0; index < 8; index += 1) await opacitySlider.press("ArrowRight");
    await expect(page.getByText("45%", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Lock", exact: true }).click();

    await expect(page).toHaveScreenshot("11-background-image-editing-tools.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.015,
    });

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Background image settings" }).click();
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    await page.keyboard.press("Escape");

    page.once("dialog", (dialog) => dialog.accept());
    await backgroundInput.setInputFiles({
      name: "floorplan-replacement.svg",
      mimeType: "image/svg+xml",
      buffer: floorplanSvg,
    });
    await page.getByRole("button", { name: "Background image settings" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Remove background image" }).click();
    await expect(page.getByRole("button", { name: "Add background image" })).toBeVisible();
  });

  test("zooms, pans, fits, changes theme, and resets the chart", async ({ page }) => {
    await openPlanner(page);
    const canvas = canvasShell(page);
    const zoom = canvas.getByText(/%$/).last();
    const initialZoom = await zoom.textContent();

    await canvas.hover();
    await page.mouse.wheel(0, -500);
    await expect(zoom).not.toHaveText(initialZoom ?? "");

    await page.keyboard.down("Alt");
    await expect(page.getByText("Panning Mode")).toBeVisible();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Canvas did not have a bounding box");
    await page.mouse.move(box.x + box.width - 120, box.y + box.height - 120);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 40, box.y + box.height - 60, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await page.keyboard.press("Control+0");
    await expect(zoom).toHaveText(initialZoom ?? "");

    await page.getByRole("button", { name: "Open chart menu" }).click();
    await page.getByRole("menuitem", { name: "Use dark theme" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page).toHaveScreenshot("12-dark-theme-fitted-chart.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.015,
    });

    await page.getByRole("button", { name: "Open chart menu" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("menuitem", { name: "Reset chart" }).click();
    await expect(page.getByRole("button", { name: "Draw Event Space" })).toBeVisible();
    await expect(page.getByText("0 Tables", { exact: true })).toBeVisible();
  });
});

test.describe("Seating planner — mobile task workflow", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    colorScheme: "light",
  });

  test("uses a guest-first task switcher and opens semantic layout controls", async ({ page }) => {
    await openPlanner(page, { hideToasts: false, expectCanvas: false });

    const guestsTab = page.getByRole("tab", { name: "Guests" });
    const layoutTab = page.getByRole("tab", { name: "Layout" });
    await expect(guestsTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".konvajs-content")).toHaveCount(0);

    await page.getByRole("searchbox", { name: "Find a guest or table" }).fill("Guest 055");
    await page.getByRole("button", { name: "Show Guest 055 on chart" }).click();

    await expect(layoutTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".konvajs-content")).toBeVisible();
    const inspector = page.locator("[data-table-inspector]");
    await expect(inspector.getByRole("heading", { name: "Table 6" })).toBeVisible();
    await expect(inspector.getByRole("button", { name: "Seating layout" })).toBeVisible();
    await expect.poll(async () => {
      const point = await worldToPage(page, 160, 605);
      const stageBox = await page.locator("[data-canvas-stage]").boundingBox();
      const inspectorBox = await inspector.boundingBox();
      if (!stageBox || !inspectorBox) return false;
      return (
        point.x >= stageBox.x + 60 &&
        point.x <= stageBox.x + stageBox.width - 60 &&
        point.y >= stageBox.y + 50 &&
        point.y <= inspectorBox.y - 50
      );
    }).toBe(true);

    await expect(page).toHaveScreenshot("15-mobile-layout-task-inspector.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });

    await guestsTab.click();
    await page.getByRole("button", { name: "Sync Accepted Guests" }).click();
    const toast = page
      .getByText("Guest List Synced", { exact: true })
      .locator("xpath=ancestor::*[@data-state='open'][1]");
    await expect(toast).toBeVisible();
    const toastBox = await toast.boundingBox();
    const switcherBox = await page.locator("[data-mobile-task-switcher]").boundingBox();
    if (!toastBox || !switcherBox) throw new Error("Mobile toast or task switcher was not measurable");
    expect(toastBox.y).toBeGreaterThanOrEqual(switcherBox.y + switcherBox.height);
    await expect(page.getByRole("button", { name: "Dismiss notification" })).toBeVisible();
    await expect(toast).toBeHidden({ timeout: 6_000 });
  });
});
