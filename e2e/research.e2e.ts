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

/** Phone: open the Train / Research sheet. Desktop: the grid is already in the panel. */
async function openSheet(page: Page, phone: boolean): Promise<void> {
  if (!phone) return;
  const tab = page.locator('#menu-tabs [data-menu="train"]');
  await expect(tab).toBeVisible();
  if ((await tab.getAttribute('aria-pressed')) !== 'true') await tab.tap();
  await expect(page.locator('body')).toHaveClass(/menu-train/);
}

test('research a tech at a storehouse, see it queue, finish, and speed up wood', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'phone';
  const errors = await boot(page);

  const ids = await page.evaluate(() => {
    const w = window as any;
    w.dev.give({ food: 2000, wood: 2000, gold: 2000, stone: 2000 });
    const store = w.dev.placeComplete('storehouse');
    w.game.rig.focusOn(w.game.world.townCenter.pos);
    w.game.selection.set([store]);
    return { store, tc: w.game.world.townCenter.id };
  });
  expect(ids.store).not.toBeNull();

  await openSheet(page, phone);
  await expect(page.locator('#train-grid .research-head')).toBeVisible();
  const axe = page.locator('#train-grid [data-research="bronzeAxe"]');
  await expect(axe).toBeVisible();
  await expect(axe).toHaveAttribute('data-locked', 'false');
  await expect(axe).toHaveAttribute('title', /\+15% wood gathering/);
  if (phone) await axe.tap();
  else await axe.click();

  // Queued: it moves to the queue strip, and the chain's next tech shows why it waits.
  await expect(page.locator('#train-queue .queue-item.tech[data-tech="bronzeAxe"]')).toBeVisible();
  await expect(page.locator('#unit-status')).toHaveText(/Researching Bronze Axe/);
  const iron = page.locator('#train-grid [data-research="ironAxe"]');
  await expect(iron).toHaveAttribute('data-locked', 'true');
  await expect(iron.locator('.build-lock')).toHaveText(/Requires (Bronze Axe|Town Age)/);

  const before = await page.evaluate(() => (window as any).dev.statOf({ unit: 'villager' }, 'gather.wood', 1));
  expect(before).toBe(1);
  await page.evaluate(() => (window as any).dev.fastForward(30));

  await expect(page.locator('.toast-research')).toHaveText(/Bronze Axe researched/);
  await expect(page.locator('#train-queue .queue-item.tech')).toHaveCount(0);
  const after = await page.evaluate(() => (window as any).dev.statOf({ unit: 'villager' }, 'gather.wood', 1));
  expect(after).toBeCloseTo(1.15);

  // The Town Age needs two Village Age buildings: only the storehouse stands.
  await page.evaluate((tc) => (window as any).game.selection.set([tc]), ids.tc);
  await openSheet(page, phone);
  const age = page.locator('#train-grid [data-research="townAge"]');
  await expect(age).toBeVisible();
  await expect(age).toHaveAttribute('data-locked', 'true');
  await expect(age.locator('.build-lock')).toHaveText('Requires 2 Village Age buildings (1/2)');
  await expect(page.locator('#age-plaque')).toContainText(phone ? '' : 'Village Age');

  // A second one unlocks it; researching it advances the age, with the banner and plaque.
  await page.evaluate(() => (window as any).dev.placeComplete('granary'));
  await expect(age).toHaveAttribute('data-locked', 'false');
  if (phone) await age.tap();
  else await age.click();
  await expect(page.locator('#age-plaque')).toHaveClass(/advancing/);
  await page.evaluate(() => (window as any).dev.fastForward(61));
  await expect(page.locator('#age-banner')).toHaveText('Entered the Town Age');
  await expect(page.locator('#res-age')).toHaveText('Town Age');

  // Nothing scrolls sideways.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test('age-locked build tiles say which age they need', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'phone';
  const errors = await boot(page);
  await page.evaluate(() => {
    const g = (window as any).game;
    const v = [...g.world.units.values()].find((u: any) => u.owner === g.world.localPlayer && u.kind === 'villager');
    g.selection.set([v.id]);
  });
  if (phone) await page.locator('#menu-tabs [data-menu="build"]').tap();
  const forge = page.locator('#build-grid [data-build="forge"]');
  await expect(forge).toHaveClass(/locked/);
  await expect(forge.locator('.build-lock')).toHaveText('Requires Town Age');
  await expect(page.locator('#build-grid [data-build="house"]')).not.toHaveClass(/locked/);
  if (!phone) await expect(forge.locator('kbd')).toHaveText('J');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});
