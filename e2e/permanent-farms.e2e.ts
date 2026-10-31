import { expect, test } from '@playwright/test';

test('a completed farm keeps producing without reseeding and shows its assigned worker', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?e2e');
  await page.waitForFunction(() => (window as any).game?.renderer?.webgl?.info?.render?.frame > 2);
  const fixture = await page.evaluate(() => {
    const g = (window as any).game;
    const w = g.world;
    const id = (window as any).dev.placeComplete('farm');
    if (id === null) throw new Error('No farm placement available');
    const farm = w.buildings.get(id);
    // An old saved field with no remaining food must still be usable.
    farm.food = 0;
    const worker = [...w.units.values()].find((u: any) => u.kind === 'villager' && u.owner === w.localPlayer) as any;
    worker.pos = { ...farm.pos };
    worker.prevPos = { ...farm.pos };
    w.dispatch({ type: 'gather', unitIds: [worker.id], nodeId: id });
    g.selection.set([id]);
    return { id, workerId: worker.id, food: w.stock.food, wood: w.stock.wood };
  });
  await expect(page.locator('#unit-status')).toHaveText('Renewable food · 1/1 villager assigned');
  const worked = await page.evaluate(fixture => {
    const w = (window as any).game.world;
    // More food than a legacy field held, across many delivery trips.
    (window as any).dev.fastForward(480);
    return { food: w.stock.food, wood: w.stock.wood, source: w.units.get(fixture.workerId).gatherNode };
  }, fixture);
  expect(worked.food - fixture.food).toBeGreaterThan(250);
  expect(worked.wood).toBe(fixture.wood);
  expect(worked.source).toBe(fixture.id);
  await page.evaluate(fixture => {
    const w = (window as any).game.world;
    w.dispatch({ type: 'stop', unitIds: [fixture.workerId] });
  }, fixture);
  await expect(page.locator('#unit-status')).toHaveText('Renewable food · 0/1 villager assigned');
  const stopped = await page.evaluate(() => {
    const w = (window as any).game.world;
    const food = w.stock.food;
    (window as any).dev.fastForward(30);
    return { before: food, after: w.stock.food };
  });
  expect(stopped.after).toBe(stopped.before);
  expect(errors).toEqual([]);
});
