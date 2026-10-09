import { expect, test, type Page } from '@playwright/test';

/** Load the game with the test hook and collect page errors. */
async function boot(page: Page, query = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`/?e2e${query}`);
  await page.waitForFunction(() => (window as any).game?.renderer?.webgl?.info?.render?.frame > 2, null, { timeout: 30_000 });
  return errors;
}

test('boots, renders and shows the HUD without errors', async ({ page }) => {
  const errors = await boot(page);
  await expect(page).toHaveTitle('Ages Ago');
  await expect(page.locator('#game-container canvas')).toBeVisible();
  for (const id of ['#res-food', '#res-wood', '#res-gold', '#res-pop', '#train-btn']) {
    await expect(page.locator(id)).toBeVisible();
  }
  const calls = await page.evaluate(() => (window as any).game.renderer.webgl.info.render.calls);
  expect(calls).toBeGreaterThan(5);
  expect(errors).toEqual([]);
});

test('villagers gather and deposit food', async ({ page }) => {
  await boot(page);
  const food = await page.evaluate(() => {
    const g = (window as any).game;
    const w = g.world;
    const tc = w.townCenter.pos;
    const berries = [...w.nodes.values()]
      .filter((n: any) => n.kind === 'berry')
      .sort((a: any, b: any) => Math.hypot(a.pos.x - tc.x, a.pos.z - tc.z) - Math.hypot(b.pos.x - tc.x, b.pos.z - tc.z));
    const villagers = [...w.units.values()].filter((u: any) => u.kind === 'villager').map((u: any) => u.id);
    w.dispatch({ type: 'gather', unitIds: villagers, nodeId: berries[0].id });
    for (let i = 0; i < 20 * 60; i++) w.tick(0.05);
    return w.stock.food;
  });
  expect(food).toBeGreaterThan(0);
  await expect(page.locator('#res-food')).not.toHaveText('0');
});

test('the scout explores and the fog lifts', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const w = (window as any).game.world;
    const scout = [...w.units.values()].find((u: any) => u.kind === 'scout');
    const before = w.visibility.exploredFraction;
    w.dispatch({ type: 'explore', unitIds: [scout.id] });
    for (let i = 0; i < 20 * 45; i++) w.tick(0.05);
    return { before, after: w.visibility.exploredFraction, state: scout.state };
  });
  expect(result.after).toBeGreaterThan(result.before + 0.05);
  expect(result.state).toBe('exploring');
});

test('villagers build a house and the population cap rises', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const w = (window as any).game.world;
    const tc = w.townCenter.pos;
    w.stock.wood = 200;
    const villagers = [...w.units.values()].filter((u: any) => u.kind === 'villager').map((u: any) => u.id);
    let pos = null;
    for (let r = 6; r < 14 && !pos; r += 0.5) {
      for (let a = 0; a < 16 && !pos; a++) {
        const p = { x: tc.x + Math.cos(a) * r, z: tc.z + Math.sin(a) * r };
        if (w.canPlace('house', p, 0).ok) pos = p;
      }
    }
    if (!pos) return { placed: false, capBefore: w.popCap, capAfter: w.popCap };
    const capBefore = w.popCap;
    w.dispatch({ type: 'build', unitIds: villagers, kind: 'house', pos, rot: 0 });
    for (let i = 0; i < 20 * 40; i++) w.tick(0.05);
    return { placed: true, capBefore, capAfter: w.popCap };
  });
  expect(result.placed).toBe(true);
  expect(result.capAfter).toBe(result.capBefore + 5);
  await expect(page.locator('#res-pop')).toContainText(`/${result.capAfter}`);
});

for (const tier of ['low', 'high']) {
  test(`quality=${tier} boots cleanly`, async ({ page }) => {
    const errors = await boot(page, `&quality=${tier}`);
    expect(await page.evaluate(() => (window as any).game.quality.tier)).toBe(tier);
    expect(errors).toEqual([]);
  });
}

test('layout fits the viewport (no horizontal scroll)', async ({ page }) => {
  await boot(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
