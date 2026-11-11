import { expect, test, type Page } from '@playwright/test';

/** Load the game with the test hook and collect page errors. Phones run at 360 px wide. */
async function boot(page: Page, phone: boolean): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  if (phone) await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/?e2e');
  await page.waitForFunction(() => (window as any).game?.renderer?.webgl?.info?.render?.frame > 2, null, { timeout: 30_000 });
  return errors;
}

/** Empty the local stockpile, then add `stock`. */
async function setStock(page: Page, stock: Record<string, number>): Promise<void> {
  await page.evaluate((add) => {
    const w = window as any;
    const s = w.game.world.stockOf(w.game.world.localPlayer);
    for (const k of Object.keys(s)) s[k] = 0;
    w.dev.give(add);
  }, stock);
}

async function noSideScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test('buildings with a ready tech get a badge, and the panel marks it', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'phone';
  const errors = await boot(page, phone);
  const store = await page.evaluate(() => {
    const w = window as any;
    const id = w.dev.placeComplete('storehouse');
    w.game.rig.focusOn(w.game.world.buildings.get(id).pos);
    return id as number;
  });
  await setStock(page, {});
  const badge = page.locator(`.upgrade-badge[data-building="${store}"]`);
  await expect(page.locator('.upgrade-badge:visible')).toHaveCount(0);

  // Bronze Axe becomes affordable: the storehouse gets its badge within a refresh.
  await setStock(page, { food: 500, wood: 500, gold: 500 });
  await expect(badge).toBeVisible();

  await page.evaluate((id) => (window as any).game.selection.set([id]), store);
  await expect(page.locator('.unit-portrait')).toHaveClass(/upgrade-ready/);
  await expect(page.locator('.unit-portrait')).toHaveAttribute('title', /Upgrade available: .*Bronze Axe/);
  if (phone) {
    const tab = page.locator('#menu-tabs [data-menu="train"]');
    await expect(tab).toHaveClass(/has-upgrade/);
    await tab.tap();
  }
  await expect(page.locator('#train-grid [data-research="bronzeAxe"]')).toHaveClass(/ready/);

  // Spent: no badge, no mark, and the tile says what is short.
  await setStock(page, {});
  await expect(badge).toBeHidden();
  await expect(page.locator('.unit-portrait')).not.toHaveClass(/upgrade-ready/);
  await expect(page.locator('#train-grid [data-research="bronzeAxe"] .build-lock')).toHaveText(/Not enough (food|wood)/);
  await noSideScroll(page);
  expect(errors).toEqual([]);
});

test('train tiles explain locks the same way as research tiles', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'phone';
  const errors = await boot(page, phone);
  const tc = await page.evaluate(() => (window as any).game.world.townCenter.id as number);
  await setStock(page, {});
  await page.evaluate((id) => (window as any).game.selection.set([id]), tc);
  if (phone) await page.locator('#menu-tabs [data-menu="train"]').tap();
  await expect(page.locator('#train-grid [data-train="villager"] .build-lock')).toHaveText('Not enough food');
  await setStock(page, { food: 500 });
  await expect(page.locator('#train-grid [data-train="villager"] .build-lock')).toHaveText('');
  expect(errors).toEqual([]);
});

test('age chip shows progress, opens the Town Center, and the age-up lists unlocks', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'phone';
  const errors = await boot(page, phone);
  await page.evaluate(() => (window as any).dev.placeComplete('storehouse'));
  // 120 food short of the Town Age (300 food since M13-3).
  await setStock(page, { food: 180 });

  const chip = page.locator('#age-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute('data-short', 'Town 1/2\n−120 food');
  if (!phone) await expect(chip).toHaveText('Town Age · 1/2 buildings · need 120 food');
  await expect(chip).toHaveAttribute('title', /Build 2 different Village Age buildings \(1\/2\)/);
  const box = (await chip.boundingBox())!;
  const width = page.viewportSize()!.width;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);

  // Clicking it selects the Town Center (and opens Research on a phone).
  await page.evaluate(() => (window as any).game.selection.clear());
  if (phone) await chip.tap();
  else await chip.click();
  await expect(page.locator('#unit-name')).toHaveText('Town Center');
  if (phone) await expect(page.locator('body')).toHaveClass(/menu-train/);
  await expect(page.locator('#train-grid [data-research="townAge"]')).toBeVisible();

  // Second building and the food: ready.
  await page.evaluate(() => (window as any).dev.placeComplete('granary'));
  await setStock(page, { food: 1000 });
  await expect(chip).toHaveClass(/ready/);
  await expect(chip).toHaveAttribute('data-short', 'Town ready');

  const age = page.locator('#train-grid [data-research="townAge"]');
  if (phone) await age.tap();
  else await age.click();
  await expect(chip).toHaveClass(/advancing/);
  await page.evaluate(() => (window as any).dev.fastForward(61));
  await expect(page.locator('.toast-age')).toContainText('Town Age unlocks: build');
  await expect(page.locator('.toast-age')).toContainText('Forge');
  // Next goal: the City Age.
  await expect(chip).toHaveAttribute('data-short', /^City /);
  await noSideScroll(page);
  expect(errors).toEqual([]);
});
