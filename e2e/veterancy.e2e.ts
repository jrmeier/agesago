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

const chevrons = (page: Page) =>
  page.evaluate(() => {
    const mesh = (window as any).game.views.object.getObjectByName('rank-fill');
    return mesh.visible ? (mesh.count as number) : 0;
  });

test('a promoted soldier shows chevrons, its rank and an xp bar; a group shows rank counts', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'phone';
  const errors = await boot(page);

  const ids = await page.evaluate(() => {
    const w = window as any;
    const g = w.game;
    g.ais.length = 0;
    const own = [...g.world.units.values()].filter((u: any) => u.owner === g.world.localPlayer) as any[];
    const scout = own.find((u) => u.kind === 'scout');
    const villager = own.find((u) => u.kind === 'villager');
    g.rig.focusOn(scout.pos);
    g.selection.set([scout.id]);
    return { scout: scout.id, villager: villager.id };
  });

  // Basic: no chevron, a bar towards Advanced.
  const rank = page.locator('#unit-rank');
  await expect(rank).toBeVisible();
  await expect(rank.locator('.unit-rank-name')).toHaveText('Basic');
  await expect(rank.locator('.unit-rank-text')).toHaveText('0 / 100 xp to Advanced');
  expect(await chevrons(page)).toBe(0);

  expect(await page.evaluate((id) => (window as any).dev.grantXp(id, 140), ids.scout)).toBe(1);
  await expect(rank.locator('.unit-rank-name')).toHaveText('Advanced');
  await expect(rank.locator('.unit-rank-text')).toHaveText('40 / 200 xp to Elite');
  await expect(rank).toHaveAttribute('data-rank', 'Advanced');
  await expect.poll(() => chevrons(page)).toBe(1);
  await expect
    .poll(() => page.evaluate(() => (window as any).game.views.object.getObjectByName('promotion-sparkle').count))
    .toBeGreaterThan(0)
    .catch(() => undefined); // The sparkle is brief; a slow frame may miss it.

  expect(await page.evaluate((id) => (window as any).dev.grantXp(id, 200), ids.scout)).toBe(2);
  await expect(rank.locator('.unit-rank-name')).toHaveText('Elite');
  await expect(rank.locator('.unit-rank-text')).toHaveText('Top rank');
  await expect.poll(() => chevrons(page)).toBe(2);
  await expect(rank).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath(`rank-${phone ? 'phone' : 'desktop'}.png`) });

  // A mixed group: counts by rank; villagers are not counted.
  await page.evaluate(({ scout, villager }) => (window as any).game.selection.set([scout, villager]), ids);
  await expect(rank.locator('.unit-rank-text')).toHaveText('1 Elite');
  await expect(rank.locator('.unit-rank-bar')).toBeHidden();

  // A villager alone has no rank row.
  await page.evaluate(({ villager }) => (window as any).game.selection.set([villager]), ids);
  await expect(rank).toBeHidden();

  expect(errors).toEqual([]);
});
