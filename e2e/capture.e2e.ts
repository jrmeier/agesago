import { expect, test, type Page } from '@playwright/test';

/** Load the game with the test hook and collect page errors. */
async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?e2e');
  await page.waitForFunction(() => (window as any).game?.renderer?.webgl?.info?.render?.frame > 2, null, { timeout: 30_000 });
  return errors;
}

/**
 * Explore the map, drop two finished enemy houses beside the local town (dev hook), spawn three
 * swordsmen next to them, select the soldiers and aim the camera there. Returns the ids.
 */
async function stage(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).game;
    const dev = (window as any).dev;
    const w = g.world;
    w.visibility.state.fill(2);
    const rival = [...w.players.keys()].find((id: number) => w.areEnemies(w.localPlayer, id));
    if (rival === undefined) return { error: 'no rival player' };
    const tc = w.townCenter.pos;
    const near = { x: tc.x + 12, z: tc.z + 4 };
    const house = dev.placeFor('house', rival, near);
    const other = dev.placeFor('house', rival, { x: near.x, z: near.z + 5 });
    if (house === null || other === null) return { error: 'no spot for the enemy houses' };
    const b = w.buildings.get(house);
    const soldiers = [0, 1, 2].map((i: number) => w.spawnUnit('swordsman', { x: b.pos.x - 3, z: b.pos.z + 1.5 + i * 0.8 }).id);
    g.selection.set(soldiers);
    // The focus point sits low on screen, behind the selection panel: aim past the houses.
    g.rig.focusOn({ x: b.pos.x, z: b.pos.z + 12 });
    // Let the fog catch up with the soldiers' sight (the houses stand past the Town Center's).
    dev.fastForward(0.5);
    return { house, other, soldiers, rival };
  });
}

/** A screen point (viewport CSS px) where the scene pick finds building `id`. */
async function onBuilding(page: Page, id: number) {
  const frame = await page.evaluate(() => (window as any).game.renderer.webgl.info.render.frame);
  await page.waitForFunction((f) => (window as any).game.renderer.webgl.info.render.frame > f + 3, frame);
  return page.evaluate((id) => {
    const g = (window as any).game;
    const b = g.world.buildings.get(id);
    const cam = g.rig.camera;
    cam.updateMatrixWorld(true);
    const canvas = document.querySelector('#game-container canvas') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const v = cam.position.clone();
    v.set(b.pos.x, Math.max(0, g.rig.rts.hf.heightAt(b.pos.x, b.pos.z)) + 1, b.pos.z);
    v.project(cam);
    const cx = ((v.x + 1) / 2) * canvas.clientWidth;
    const cy = ((1 - v.y) / 2) * canvas.clientHeight;
    for (let dy = -24; dy <= 24; dy += 4) {
      for (let dx = -24; dx <= 24; dx += 4) {
        const sx = cx + dx;
        const sy = cy + dy;
        const ndc = { x: (sx / canvas.clientWidth) * 2 - 1, y: -(sy / canvas.clientHeight) * 2 + 1 };
        if (g.views.pick(ndc, cam, 'order') !== id) continue;
        if (document.elementFromPoint(rect.left + sx, rect.top + sy) !== canvas) continue;
        return { x: rect.left + sx, y: rect.top + sy };
      }
    }
    return null;
  }, id);
}

test('soldiers capture an undefended enemy house on right-click; Ctrl+right-click attacks instead', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'desktop right-click');
  const errors = await boot(page);
  const cast = await stage(page);
  expect(cast).not.toHaveProperty('error');
  const { house, other, soldiers, rival } = cast as { house: number; other: number; soldiers: number[]; rival: number };

  // Ctrl+right-click the second house: an attack to destroy, no capture.
  const otherAt = await onBuilding(page, other);
  expect(otherAt).toBeTruthy();
  await page.keyboard.down('Control');
  await page.mouse.click(otherAt!.x, otherAt!.y, { button: 'right' });
  // Controls reads the click on its next frame: keep Ctrl down until then.
  const frame = await page.evaluate(() => (window as any).game.renderer.webgl.info.render.frame);
  await page.waitForFunction((f) => (window as any).game.renderer.webgl.info.render.frame > f + 2, frame);
  await page.keyboard.up('Control');
  await expect.poll(() => page.evaluate(({ id, target }) => {
    const w = (window as any).game.world;
    return { target: w.units.get(id).target === target, capture: w.combatState.get(id)?.capture ?? false };
  }, { id: soldiers[0], target: other })).toEqual({ target: true, capture: false });

  // Plain right-click on the first house: capture.
  const houseAt = await onBuilding(page, house);
  expect(houseAt).toBeTruthy();
  await page.mouse.click(houseAt!.x, houseAt!.y, { button: 'right' });
  await expect.poll(() => page.evaluate(({ id, target }) => {
    const w = (window as any).game.world;
    return { target: w.units.get(id).target === target, capture: w.combatState.get(id)?.capture ?? false };
  }, { id: soldiers[0], target: house })).toEqual({ target: true, capture: true });

  // Run the sim until the points start moving: the capture bar shows over the house.
  await page.evaluate(() => (window as any).dev.fastForward(8));
  await expect.poll(() => page.evaluate((id) => !!(window as any).game.world.buildings.get(id).capture, house)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).game.views.captureBars.count)).toBeGreaterThan(0);

  // Long enough for three soldiers to take all 275 points: the house changes hands.
  await page.evaluate(() => (window as any).dev.fastForward(60));
  const after = await page.evaluate((id) => {
    const w = (window as any).game.world;
    const b = w.buildings.get(id);
    return { owner: b.owner, capture: b.capture ?? null, local: w.localPlayer };
  }, house);
  expect(after.owner).toBe(after.local);
  expect(after.owner).not.toBe(rival);
  expect(after.capture).toBeNull();
  await expect(page.locator('.toast', { hasText: 'Captured a House' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('on a phone the Orders sheet has a Raze button that attacks the tapped building', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'touch Orders sheet');
  const errors = await boot(page);
  await expect(page.locator('body')).toHaveClass(/touch/);
  const cast = await stage(page);
  expect(cast).not.toHaveProperty('error');
  const { house, soldiers } = cast as { house: number; soldiers: number[] };

  await page.locator('#menu-tabs [data-menu="orders"]').tap();
  const raze = page.locator('#command-card [data-cmd="raze"]');
  await expect(raze).toBeVisible();
  await raze.tap();
  await expect(raze).toHaveAttribute('aria-pressed', 'true');
  const at = await onBuilding(page, house);
  expect(at).toBeTruthy();
  await page.touchscreen.tap(at!.x, at!.y);
  await expect.poll(() => page.evaluate(({ id, target }) => {
    const w = (window as any).game.world;
    return { target: w.units.get(id).target === target, capture: w.combatState.get(id)?.capture ?? false };
  }, { id: soldiers[0], target: house })).toEqual({ target: true, capture: false });
  expect(errors).toEqual([]);
});


test('destroyed and depleted alerts fit together and jump to their locations', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'phone') await page.setViewportSize({ width: 360, height: 800 });
  const errors = await boot(page);
  const fixture = await page.evaluate(() => {
    const g = (window as any).game, dev = (window as any).dev, w = g.world;
    g.rig.rts.edgeScroll = false;
    const building = dev.placeComplete('barracks');
    const camp = dev.placeComplete('miningCamp');
    if (building === null || camp === null) throw new Error('no room for feedback buildings');
    const destroyedAt = { ...w.buildings.get(building).pos };
    const depletedAt = { ...w.buildings.get(camp).pos };
    // Set up the last nearby gold node notification while keeping remote deposits intact.
    for (const [id, node] of w.nodes) {
      if (node.type === 'gold' && Math.hypot(node.pos.x - depletedAt.x, node.pos.z - depletedAt.z) <= 12) w.nodes.delete(id);
    }
    const home = w.townCenter.pos;
    const dx = depletedAt.x - home.x, dz = depletedAt.z - home.z, distance = Math.hypot(dx, dz);
    const nodePos = { x: depletedAt.x + dx / distance * 11, z: depletedAt.z + dz / distance * 11 };
    w.events.emit({ type: 'depleted', id: -1, kind: 'gold', pos: nodePos });
    dev.raze(building);
    g.rig.focusOn({ x: destroyedAt.x + 20, z: destroyedAt.z + 20 });
    return { destroyedAt, depletedAt, before: { ...g.rig.rts.target } };
  });
  const destroyed = page.locator('.toast', { hasText: 'Your Barracks was destroyed' });
  const depleted = page.locator('.toast', { hasText: 'Gold near your Mining Camp is exhausted' });
  await expect(destroyed).toBeVisible();
  await expect(depleted).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  for (const toast of [destroyed, depleted]) {
    const bounds = await toast.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(await toast.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await destroyed.click();
  const after = await page.evaluate(() => ({ ...(window as any).game.rig.rts.target }));
  expect(after).toEqual(fixture.destroyedAt);
  expect(after).not.toEqual(fixture.before);
  await depleted.click();
  expect(await page.evaluate(() => ({ ...(window as any).game.rig.rts.target }))).toEqual(fixture.depletedAt);
  expect(errors).toEqual([]);
});
