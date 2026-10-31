import { expect, test } from '@playwright/test';

test('corral assignment and gate livestock controls work on desktop and touch', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?e2e');
  await page.waitForFunction(() => (window as any).game?.renderer?.webgl?.info?.render?.frame > 2);
  const ids = await page.evaluate(() => {
    const g = (window as any).game, w = g.world, dev = (window as any).dev;
    const corral = dev.placeComplete('corral'), gate = dev.placeComplete('gate');
    if (!corral || !gate) throw new Error('No place for livestock buildings');
    const b = w.buildings.get(corral);
    for (let i = 0; i < 2; i++) { const s = w.spawnUnit('sheep', { x: b.pos.x + i, z: b.pos.z }); s.owner = w.localPlayer; }
    g.selection.set([corral]);
    return { corral, gate };
  });
  const tend = page.locator('#tend-livestock-btn');
  await expect(tend).toBeVisible(); await expect(tend).toBeEnabled();
  if (info.project.name === 'phone') { expect((await tend.boundingBox())!.height).toBeGreaterThanOrEqual(44); await tend.tap(); }
  else await tend.click();
  await expect(tend).toHaveText('Release tending villager');
  await page.evaluate(() => (window as any).dev.fastForward(130));
  await expect(page.locator('#unit-status')).toContainText('Breeding');
  await tend.click(); await expect(tend).toHaveText('Assign nearest idle villager');
  await page.evaluate(id => (window as any).game.selection.set([id]), ids.gate);
  const gate = page.locator('#gate-livestock-btn');
  await expect(gate).toHaveText('Allow own livestock passage');
  if (info.project.name === 'phone') await gate.tap(); else await gate.click();
  await expect(gate).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#unit-status')).toHaveText('Your livestock may pass');
  await gate.click(); await expect(gate).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});
