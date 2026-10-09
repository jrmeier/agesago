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

/**
 * Lay a market next to the Town Center through the sim, finish it on the spot, stock wood and
 * select it. Returns the market id (0 if no legal spot was found).
 */
async function placeMarket(page: Page): Promise<number> {
  return page.evaluate(() => {
    const g = (window as any).game;
    const w = g.world;
    w.stock.wood = 1000;
    w.stock.gold = 0;
    const tc = w.townCenter.pos;
    const villagers = [...w.units.values()].filter((u: any) => u.kind === 'villager' && u.owner === w.localPlayer).map((u: any) => u.id);
    let spot: { x: number; z: number } | null = null;
    for (let r = 6; r <= 20 && !spot; r += 2) {
      for (let a = 0; a < 16 && !spot; a++) {
        const p = { x: tc.x + Math.cos((a / 16) * Math.PI * 2) * r, z: tc.z + Math.sin((a / 16) * Math.PI * 2) * r };
        if (w.canPlace('market', p, 0).ok) spot = p;
      }
    }
    if (!spot) return 0;
    w.dispatch({ type: 'build', unitIds: villagers, kind: 'market', pos: spot, rot: 0 });
    const b = [...w.buildings.values()].find((x: any) => x.kind === 'market' && x.owner === w.localPlayer);
    if (!b) return 0;
    b.complete = true;
    b.buildProgress = 1;
    b.hp = b.maxHp;
    w.events.emit({ type: 'constructed', id: b.id });
    w.emitStock();
    g.rig.focusOn(b.pos);
    g.selection.set([b.id]);
    return b.id;
  });
}

const gold = (page: Page) => page.evaluate(() => (window as any).game.world.stock.gold as number);

test('desktop: selling wood at a market raises gold', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop layout');
  const errors = await boot(page);
  expect(await placeMarket(page)).toBeGreaterThan(0);
  const panel = page.locator('#market-panel');
  await expect(panel).toBeVisible();
  const sell = panel.locator('[data-market="sell"][data-res="wood"]');
  const buy = panel.locator('[data-market="buy"][data-res="wood"]');
  await expect(sell).toBeEnabled();
  await expect(buy).toBeDisabled();
  await expect(buy).toContainText('Need');
  await sell.click();
  await expect.poll(() => gold(page)).toBeGreaterThan(0);
  await expect(panel.locator('.market-row[data-res="wood"] .market-prices')).toContainText('buy 97');
  await expect(buy).toBeDisabled(); // 70 gold is short of the new 97 price
  expect(errors).toEqual([]);
});

test('phone: the market sits in the Train sheet without horizontal scroll', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'phone layout');
  await page.setViewportSize({ width: 360, height: 740 });
  const errors = await boot(page);
  await expect(page.locator('body')).toHaveClass(/touch/);
  expect(await placeMarket(page)).toBeGreaterThan(0);
  await expect(page.locator('#market-panel')).toBeHidden();
  await page.locator('#menu-tabs [data-menu="train"]').tap();
  await expect(page.locator('body')).toHaveClass(/menu-train/);
  const panel = page.locator('#market-panel');
  await expect(panel).toBeVisible();
  const sell = panel.locator('[data-market="sell"][data-res="wood"]');
  const box = await sell.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await sell.tap();
  await expect.poll(() => gold(page)).toBeGreaterThan(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const panelOverflow = await panel.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(panelOverflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});
