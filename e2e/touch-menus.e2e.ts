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

/** Select one local villager and centre the camera on the town, so the rest are on screen. */
async function selectOneVillager(page: Page): Promise<number> {
  return page.evaluate(() => {
    const g = (window as any).game;
    const local = g.world.localPlayer;
    g.rig.focusOn(g.world.townCenter.pos);
    const villagers = [...g.world.units.values()].filter((u: any) => u.owner === local && u.kind === 'villager');
    g.selection.set([villagers[0].id]);
    return villagers.length;
  });
}

test('desktop keeps build, train, and orders in the selection panel', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop layout');
  const errors = await boot(page);
  const total = await selectOneVillager(page);
  expect(total).toBeGreaterThan(1);
  const layout = await page.evaluate(() => {
    const grid = document.getElementById('build-grid')!;
    const tabs = document.getElementById('menu-tabs')!;
    const box = document.getElementById('touch-box')!;
    return {
      touch: document.body.classList.contains('touch'),
      grid: getComputedStyle(grid).display,
      tabs: getComputedStyle(tabs).display,
      // The button's own display stays flex; the bar around it is what hides it.
      bar: getComputedStyle(box.parentElement!).display,
    };
  });
  expect(layout.touch).toBe(false);
  expect(layout.grid).toBe('grid');
  expect(layout.tabs).toBe('none');
  expect(layout.bar).toBe('none');
  expect(errors).toEqual([]);
});

test('phone sheets open from tabs, and a group of units can be selected', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'phone layout');
  const errors = await boot(page);
  await expect(page.locator('body')).toHaveClass(/touch/);
  const total = await selectOneVillager(page);
  expect(total).toBeGreaterThan(1);

  await expect(page.locator('#menu-tabs')).toBeVisible();
  await expect(page.locator('#menu-tabs [data-menu="build"]')).toBeVisible();
  await expect(page.locator('#menu-tabs [data-menu="orders"]')).toBeVisible();
  await expect(page.locator('#menu-tabs [data-menu="train"]')).toBeHidden();
  await expect(page.locator('#touch-select-all')).toHaveAttribute('aria-label', 'Select all your units');

  const closed = await page.evaluate(() => getComputedStyle(document.getElementById('build-grid')!).display);
  expect(closed).toBe('none');

  await page.locator('#menu-tabs [data-menu="build"]').tap();
  await expect(page.locator('body')).toHaveClass(/menu-build/);
  const open = await page.evaluate(() => {
    const grid = document.getElementById('build-grid')!;
    const name = grid.querySelector('.build-name')!;
    return {
      grid: getComputedStyle(grid).display,
      name: getComputedStyle(name).display,
      columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
    };
  });
  expect(open.grid).toBe('grid');
  expect(open.name).not.toBe('none');
  expect(open.columns).toBe(3);

  await page.locator('#menu-tabs [data-menu="orders"]').tap();
  await expect(page.locator('body')).not.toHaveClass(/menu-build/);
  await expect(page.locator('#command-card')).toBeVisible();
  await expect(page.locator('#build-grid')).toBeHidden();

  // These: every visible villager, not only the one that was selected.
  await page.locator('#select-same-btn').tap();
  await expect.poll(async () => page.evaluate(() => (window as any).game.selection.ids.size)).toBeGreaterThan(1);

  // Box: arm, drag a rectangle, and see the selection marquee. A tap cancels without ordering.
  await page.evaluate(() => {
    const g = (window as any).game;
    const local = g.world.localPlayer;
    const one = [...g.world.units.values()].find((u: any) => u.owner === local && u.kind === 'villager');
    g.selection.set([one.id]);
  });
  await page.locator('#touch-box').tap();
  await expect(page.locator('#touch-box')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#select-hint')).toBeVisible();

  const canvas = page.locator('#game-container canvas');
  const bounds = await canvas.boundingBox();
  expect(bounds).toBeTruthy();
  const from = { x: bounds!.x + bounds!.width * 0.3, y: bounds!.y + bounds!.height * 0.35 };
  const to = { x: bounds!.x + bounds!.width * 0.7, y: bounds!.y + bounds!.height * 0.62 };
  const client = await page.context().newCDPSession(page);
  const point = (x: number, y: number) => ({ x: Math.round(x), y: Math.round(y), radiusX: 1, radiusY: 1, id: 1 });
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(from.x, from.y)] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(to.x, to.y)] });
  await expect.poll(async () => page.locator('.select-box').evaluate((el) => getComputedStyle(el).display)).toBe('block');
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
  await expect.poll(async () => page.evaluate(() => (window as any).game.selection.ids.size)).toBeGreaterThan(1);
  await expect(page.locator('#touch-box')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#select-hint')).toBeHidden();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});
