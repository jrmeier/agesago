import { expect, test } from '@playwright/test';

/** M15-3: soldiers shelter in the Town Center, the panel lists who is inside, and Ungarrison empties it. */
test('soldiers garrison in the Town Center, are listed by kind, and step out on Ungarrison', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'Desktop panel check (the list uses the shared selection panel on touch too).');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?e2e');
  await page.waitForFunction(() => (window as any).game?.renderer?.webgl?.info?.render?.frame > 2);
  const tcId = await page.evaluate(() => {
    const g = (window as any).game, w = g.world;
    const tc = w.townCenterOf(w.localPlayer);
    const ids = (['hoplite', 'archer', 'archer', 'villager'] as const).map((k) => w.spawnUnit(k, { x: tc.pos.x, z: tc.pos.z }, w.localPlayer).id);
    w.dispatch({ type: 'garrison', unitIds: ids, buildingId: tc.id });
    g.selection.set([tc.id]);
    return tc.id as number;
  });
  const list = page.locator('#garrison-list');
  await expect(list).toBeVisible();
  await expect(list).toContainText('Archer ×2');
  await expect(list).toContainText('Hoplite ×1');
  const occupants = await page.evaluate((id) => (window as any).game.world.buildings.get(id).occupants.length, tcId);
  expect(occupants).toBeGreaterThanOrEqual(4);

  const out = page.locator('#ungarrison-btn');
  await expect(out).toBeVisible();
  await out.click();
  await expect.poll(() => page.evaluate((id) => (window as any).game.world.buildings.get(id).occupants?.length ?? 0, tcId)).toBe(0);
  await expect(list).toBeHidden();
  expect(errors).toEqual([]);
});
