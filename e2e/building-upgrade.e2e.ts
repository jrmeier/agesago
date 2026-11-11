import { expect, test, type Page } from '@playwright/test';

/** Load the game with the test hook and collect page errors. */
async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/?e2e');
  await page.waitForFunction(() => (window as any).game?.renderer?.webgl?.info?.render?.frame > 2, null, { timeout: 30_000 });
  return errors;
}

/** Phone: open the Upgrade sheet. Desktop: the grid is already in the panel. */
async function openSheet(page: Page, phone: boolean): Promise<void> {
  if (!phone) return;
  const tab = page.locator('#menu-tabs [data-menu="train"]');
  await expect(tab).toBeVisible();
  await expect(tab).toHaveText('Upgrade');
  if ((await tab.getAttribute('aria-pressed')) !== 'true') await tab.tap();
  await expect(page.locator('body')).toHaveClass(/menu-train/);
}

async function press(page: Page, phone: boolean, selector: string): Promise<void> {
  const el = page.locator(selector);
  if (phone) await el.tap();
  else await el.click();
}

const house = (page: Page, id: number) =>
  page.evaluate((id) => {
    const b = (window as any).game.world.buildings.get(id);
    return { tier: b.tier ?? 0, upgrading: b.upgrading ?? null, wood: (window as any).game.world.stock.wood };
  }, id);

test('upgrade a house from its panel: locked reason, progress, cancel with refund, then finish', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'phone';
  const errors = await boot(page);

  const ids = await page.evaluate(() => {
    const w = window as any;
    w.dev.give({ food: 2000, wood: 2000, gold: 2000, stone: 2000 });
    const a = w.dev.placeComplete('house');
    const b = w.dev.placeComplete('house');
    w.game.rig.focusOn(w.game.world.townCenter.pos);
    w.game.selection.set([a]);
    return { a, b };
  });
  expect(ids.a).not.toBeNull();
  expect(ids.b).not.toBeNull();

  // Village Age: the tile is there, with the before → after stats, but locked by age.
  await openSheet(page, phone);
  const tile = page.locator('#train-grid [data-upgrade="largeHouse"]');
  await expect(tile).toBeVisible();
  await expect(tile.locator('.build-name')).toHaveText('Large House');
  await expect(tile.locator('.upgrade-stats')).toContainText('Pop +5 → +10');
  await expect(tile).toHaveAttribute('data-locked', 'true');
  await expect(tile.locator('.build-lock')).toHaveText('Requires Town Age');

  // Town Age: it unlocks. Start it, then cancel it for a full refund.
  await page.evaluate(() => (window as any).dev.setAge(1));
  await expect(tile).toHaveAttribute('data-locked', 'false');
  const before = await house(page, ids.a);
  await press(page, phone, '#train-grid [data-upgrade="largeHouse"]');
  await expect(page.locator('#unit-status')).toHaveText(/Upgrading to Large House \d+%/);
  await expect(page.locator('#build-progress')).toBeVisible();
  await expect(page.locator('#cancel-upgrade-btn')).toBeVisible();
  await expect(tile).toHaveCount(0);
  expect((await house(page, ids.a)).wood).toBe(before.wood - 60);

  if (phone) await page.locator('#touch-sheet-close').tap();
  await press(page, phone, '#cancel-upgrade-btn');
  await expect(page.locator('#cancel-upgrade-btn')).toBeHidden();
  const cancelled = await house(page, ids.a);
  expect(cancelled.upgrading).toBeNull();
  expect(cancelled.wood).toBe(before.wood);

  // Both houses selected: one press (the hotkey on desktop) upgrades each of them.
  await page.evaluate((ids) => (window as any).game.selection.set([ids.a, ids.b]), ids);
  if (phone) {
    await openSheet(page, phone);
    await press(page, phone, '#train-grid [data-upgrade="largeHouse"]');
  } else {
    // Under load a frame can miss a press; pressing again is harmless (busy buildings are skipped).
    await expect(async () => {
      await page.keyboard.press('Shift+KeyU');
      await expect(page.locator('#unit-status')).toHaveText(/Upgrading to Large House/, { timeout: 1500 });
    }).toPass({ timeout: 15_000 });
  }
  await expect(page.locator('#unit-status')).toHaveText(/Upgrading to Large House/);
  expect((await house(page, ids.a)).upgrading).not.toBeNull();
  expect((await house(page, ids.b)).upgrading).not.toBeNull();

  await page.evaluate(() => (window as any).dev.fastForward(25));
  expect(await house(page, ids.a)).toMatchObject({ tier: 1, upgrading: null });
  expect(await house(page, ids.b)).toMatchObject({ tier: 1, upgrading: null });
  // The sim state is checked above; the panel just needs a frame (slow under a loaded machine).
  await expect(page.locator('#unit-name')).toHaveText('Large House', { timeout: 15_000 });
  // Fully upgraded: no upgrade tile and no progress bar.
  await expect(page.locator('#build-progress')).toBeHidden();
  await expect(page.locator('#train-grid [data-upgrade]')).toHaveCount(0);

  expect(errors).toEqual([]);
});
