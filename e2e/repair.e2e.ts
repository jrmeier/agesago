import { expect, test } from '@playwright/test';

test('a villager repairs a damaged house by right-click', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop right-click');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?e2e');
  await page.waitForFunction(() => (window as any).game?.renderer?.webgl?.info?.render?.frame > 2);

  const fixture = await page.evaluate(() => {
    const g = (window as any).game;
    const dev = (window as any).dev;
    const w = g.world;
    dev.give({ wood: 200 });
    g.rig.rts.edgeScroll = false;
    const houseId = dev.placeComplete('house');
    if (houseId === null) throw new Error('no room for a house');
    dev.setHp(houseId, 100);
    const house = w.buildings.get(houseId);
    const villager = [...w.units.values()].find((u: any) => u.kind === 'villager' && u.owner === w.localPlayer);
    w.dispatch({ type: 'stop', unitIds: [villager.id] });
    // Show the hint on the damaged house first.
    g.selection.set([houseId]);
    g.rig.focusOn(house.pos);
    return { houseId, villagerId: villager.id, pos: house.pos };
  });

  await expect(page.locator('#unit-status')).toContainText('Right-click it with workers to repair');

  await page.evaluate(({ villagerId }) => (window as any).game.selection.set([villagerId]), fixture);
  // Find a screen point that picks the house.
  const aim = await page.evaluate((fixture) => {
    const g = (window as any).game;
    const camera = g.rig.camera;
    camera.updateMatrixWorld(true);
    const canvas = document.querySelector('#game-container canvas') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const y = Math.max(0, g.world.hf.heightAt(fixture.pos.x, fixture.pos.z));
    const p = camera.position.clone().set(fixture.pos.x, y + 1, fixture.pos.z).project(camera);
    const cx = (p.x + 1) * canvas.clientWidth / 2;
    const cy = (1 - p.y) * canvas.clientHeight / 2;
    for (let r = 0; r <= 40; r += 4) {
      for (let a = 0; a < 8; a++) {
        const dx = Math.round(Math.cos(a * Math.PI / 4) * r), dy = Math.round(Math.sin(a * Math.PI / 4) * r);
        const x = rect.left + cx + dx, sy = rect.top + cy + dy;
        if (document.elementFromPoint(x, sy) !== canvas) continue;
        const ndc = { x: (cx + dx) / canvas.clientWidth * 2 - 1, y: 1 - (cy + dy) / canvas.clientHeight * 2 };
        if (g.views.pick(ndc, camera) === fixture.houseId) return { x, y: sy };
        if (r === 0) break;
      }
    }
    throw new Error('house not under any probed pixel');
  }, fixture);

  const before = await page.evaluate(() => (window as any).game.world.stock.wood);
  await page.mouse.click(aim.x, aim.y, { button: 'right' });
  await expect.poll(() => page.evaluate(({ villagerId }) => {
    const w = (window as any).game.world;
    return [w.units.get(villagerId).state, w.buildState.get(villagerId)];
  }, fixture)).toEqual(['toRepair', fixture.houseId]);

  const after = await page.evaluate(({ houseId, villagerId }) => {
    const w = (window as any).game.world;
    (window as any).dev.fastForward(60);
    const b = w.buildings.get(houseId);
    return { hp: b.hp, maxHp: b.maxHp, state: w.units.get(villagerId).state, wood: w.stock.wood };
  }, fixture);
  expect(after.hp).toBe(after.maxHp);
  expect(after.state).toBe('idle');
  expect(before - after.wood).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
