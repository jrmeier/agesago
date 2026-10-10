import { expect, test } from '@playwright/test';

test('train a priest, recover a relic, and see its temple income', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?e2e');
  await page.waitForFunction(() => (window as any).game?.renderer?.webgl?.info?.render?.frame > 2);
  const temple = await page.evaluate(() => {
    const w = window as any; w.dev.give({ wood: 2000, stone: 2000, gold: 1000 }); w.dev.setAge(1);
    const id = w.dev.placeComplete('temple'); w.game.selection.set([id]); w.game.rig.focusOn(w.game.world.buildings.get(id).pos); return id;
  });
  expect(temple).not.toBeNull();
  if (info.project.name === 'phone') await page.locator('#menu-tabs [data-menu="train"]').tap();
  const train = page.locator('#train-grid [data-train="priest"]'); await expect(train).toBeVisible();
  if (info.project.name === 'phone') await train.tap(); else await train.click();
  await page.evaluate(() => (window as any).dev.fastForward(31));
  const priest = await page.evaluate(() => {
    const g = (window as any).game; const p = [...g.world.units.values()].find((u: any) => u.kind === 'priest') as any;
    const relic = [...g.world.exploration.values()].find((s: any) => s.kind === 'relic') as any;
    p.pos = { ...relic.pos }; p.prevPos = { ...p.pos }; g.world.tick(0.05); g.selection.set([p.id]); return p.id;
  });
  await expect(page.locator('#unit-status')).toContainText('Carrying a relic');
  const before = await page.evaluate(({ temple, priest }) => {
    const g = (window as any).game; const b = g.world.buildings.get(temple); const p = g.world.units.get(priest);
    // The player-visible move order follows the actual path into the temple's interaction ring.
    g.world.dispatch({ type: 'move', unitIds: [priest], target: { x: b.pos.x + b.radius + 0.5, z: b.pos.z } });
    // Start near the temple to bound the browser test while retaining the real move/deposit systems.
    p.pos = { x: b.pos.x + b.radius + 2, z: b.pos.z }; p.prevPos = { ...p.pos };
    g.world.dispatch({ type: 'move', unitIds: [priest], target: { x: b.pos.x + b.radius + 0.5, z: b.pos.z } });
    (window as any).dev.fastForward(5); return g.world.stock.gold;
  }, { temple, priest });
  await expect(page.locator('.toast')).toContainText(['Relic enshrined']);
  await page.evaluate(() => (window as any).dev.fastForward(10));
  expect(await page.evaluate(() => (window as any).game.world.stock.gold)).toBeGreaterThan(before + 4);
  expect(errors).toEqual([]);
});
