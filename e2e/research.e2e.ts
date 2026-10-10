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
  await expect(axe).toHaveAttribute('title', /\+\d+% wood gathering/);
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
  expect(after).toBeGreaterThan(1.1);

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

test('Town Center production stays FIFO and researched capacity reaches HUD and load model', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'phone';
  const errors = await boot(page);
  await page.evaluate(() => {
    const w = window as any;
    const g = w.game;
    g.paused = true; // Keep the render loop alive while advancing the sim explicitly.
    w.dev.give({ food: 2000, wood: 2000, gold: 2000 });
    const tc = g.world.townCenter;
    g.selection.set([tc.id]);
    g.world.dispatch({ type: 'train', buildingId: tc.id });
    for (let i = 0; i < 60; i++) g.world.tick(0.05);
    g.world.dispatch({ type: 'research', buildingId: tc.id, tech: 'wovenTunics' });
  });
  await openSheet(page, phone);
  await expect(page.locator('#train-queue .queue-item').first()).toHaveAttribute('title', /Villager.*training/);
  await expect(page.locator('#unit-status')).toHaveText(/Training/);
  await page.evaluate(() => {
    const world = (window as any).game.world;
    for (let i = 0; i < 120; i++) world.tick(0.05);
  });
  await expect(page.locator('#train-queue .queue-item').first()).toHaveAttribute('data-tech', 'wovenTunics');
  await expect(page.locator('#unit-status')).toHaveText(/Researching Woven Tunics/);
  const scale = await page.evaluate(() => {
    const w = window as any;
    const g = w.game;
    w.dev.fastForward(26);
    g.world.dispatch({ type: 'research', buildingId: g.world.townCenter.id, tech: 'donkeyPacks' });
    w.dev.fastForward(51);
    const unit = [...g.world.units.values()].find((u: any) => u.kind === 'villager' && u.owner === g.world.localPlayer) as any;
    unit.carry = { type: 'wood', amount: 3 };
    unit.gatherType = 'wood';
    unit.state = 'gathering';
    g.selection.set([unit.id]);
    return g.views.object.children.find((c: any) => c.userData.entityId === unit.id).getObjectByName('carry-wood').scale.x;
  });
  await expect(page.locator('#unit-status')).toHaveText('Chopping wood (3/13)');
  expect(scale ** 3).toBeCloseTo(1.3);
  expect(errors).toEqual([]);
});
