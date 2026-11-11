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

/** Three swordsmen and a villager to guard, on open ground in view. */
async function cast(page: Page): Promise<{ soldiers: number[]; villager: number }> {
  const ids = await page.evaluate(() => {
    const g = (window as any).game;
    const tc = g.world.townCenter.pos;
    const spot = { x: tc.x - 26, z: tc.z - 16 };
    if (!g.rig.rts.hf.isWalkable(spot.x, spot.z)) throw new Error('spot is not walkable');
    g.rig.focusOn(spot);
    const villager = g.world.spawnUnit('villager', spot);
    const soldiers = [0, 1, 2].map((i) => g.world.spawnUnit('swordsman', { x: spot.x - 5, z: spot.z - 2 + i * 1.6 }).id);
    return { soldiers, villager: villager.id };
  });
  await page.waitForFunction(() => (window as any).game.renderer.webgl.info.render.frame > 6);
  return ids;
}

/** A client point where picking finds entity `id` and nothing in the HUD covers the canvas. */
async function screenPointOf(page: Page, id: number): Promise<{ x: number; y: number }> {
  const p = await page.evaluate((id) => {
    const g = (window as any).game;
    const canvas = document.querySelector('canvas')!;
    const rect = canvas.getBoundingClientRect();
    const u = g.world.units.get(id);
    const cam = g.rig.camera;
    cam.updateMatrixWorld(true);
    const v = cam.position.clone();
    v.set(u.pos.x, Math.max(0, g.rig.rts.hf.heightAt(u.pos.x, u.pos.z)) + 1.1, u.pos.z);
    v.project(cam);
    const cx = ((v.x + 1) / 2) * canvas.clientWidth;
    const cy = ((1 - v.y) / 2) * canvas.clientHeight;
    for (let dy = -20; dy <= 28; dy += 4) {
      for (let dx = -16; dx <= 16; dx += 4) {
        const sx = cx + dx;
        const sy = cy + dy;
        const ndc = { x: (sx / canvas.clientWidth) * 2 - 1, y: -(sy / canvas.clientHeight) * 2 + 1 };
        if (g.views.pick(ndc, cam) !== id) continue;
        if (document.elementFromPoint(rect.left + sx, rect.top + sy) !== canvas) continue;
        return { x: rect.left + sx, y: rect.top + sy };
      }
    }
    return null;
  }, id);
  expect(p, `entity ${id} should be on screen`).toBeTruthy();
  return p!;
}

const guardOf = (page: Page, id: number) =>
  page.evaluate((id) => {
    const cs = (window as any).game.world.combatState.get(id);
    return cs?.order === 'guard' ? (cs.guard as number) : null;
  }, id);

/** Hotkeys run in the game frame, which can lag under a loaded machine. */
const INPUT_TIMEOUT = 15_000;

test('desktop: guard through the button, Shift+G and Alt+right-click', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'mouse and keyboard');
  const errors = await boot(page);
  const { soldiers, villager } = await cast(page);
  const button = page.locator('#command-card [data-cmd="guard"]');

  // Villagers alone get no Guard button.
  await page.evaluate((id) => (window as any).game.selection.set([id]), villager);
  await expect(button).toBeHidden();

  // Button, then click the villager.
  await page.evaluate((id) => (window as any).game.selection.set([id]), soldiers[0]);
  await expect(button).toBeVisible();
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('body')).toHaveClass(/targeting/);
  let at = await screenPointOf(page, villager);
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => guardOf(page, soldiers[0]), { timeout: INPUT_TIMEOUT }).toBe(villager);
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  // The selection is unchanged by the targeting click.
  expect(await page.evaluate(() => [...(window as any).game.selection.ids])).toEqual([soldiers[0]]);

  // Shift+G arms, Esc disarms, Shift+G again and a click guards.
  await page.evaluate((id) => (window as any).game.selection.set([id]), soldiers[1]);
  await page.keyboard.press('Shift+KeyG');
  await expect(button).toHaveAttribute('aria-pressed', 'true', { timeout: INPUT_TIMEOUT });
  await page.keyboard.press('Escape');
  await expect(button).toHaveAttribute('aria-pressed', 'false', { timeout: INPUT_TIMEOUT });
  await expect(page.locator('#pause-menu')).toBeHidden();
  await page.keyboard.press('Shift+KeyG');
  await expect(button).toHaveAttribute('aria-pressed', 'true', { timeout: INPUT_TIMEOUT });
  at = await screenPointOf(page, villager);
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => guardOf(page, soldiers[1]), { timeout: INPUT_TIMEOUT }).toBe(villager);

  // Alt+right-click on the villager guards directly.
  await page.evaluate((id) => (window as any).game.selection.set([id]), soldiers[2]);
  at = await screenPointOf(page, villager);
  await page.keyboard.down('Alt');
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.keyboard.up('Alt');
  await expect.poll(() => guardOf(page, soldiers[2]), { timeout: INPUT_TIMEOUT }).toBe(villager);

  // The guards follow the villager when it walks off.
  const dest = await page.evaluate((id) => {
    const g = (window as any).game;
    const v = g.world.units.get(id);
    const dest = { x: v.pos.x + 8, z: v.pos.z + 4 };
    g.world.dispatch({ type: 'move', unitIds: [id], target: dest });
    return dest;
  }, villager);
  await expect.poll(() => page.evaluate(({ soldiers, villager }) => {
    const g = (window as any).game;
    const v = g.world.units.get(villager);
    return v.state === 'idle' && soldiers.every((id: number) => {
      const s = g.world.units.get(id);
      return Math.hypot(s.pos.x - v.pos.x, s.pos.z - v.pos.z) < 5;
    });
  }, { soldiers, villager }), { timeout: 30_000 }).toBe(true);
  expect(await page.evaluate((id) => (window as any).game.world.units.get(id).pos, villager)).toMatchObject({
    x: expect.closeTo(dest.x, 0), z: expect.closeTo(dest.z, 0),
  });

  // A new order ends the guard.
  await page.evaluate((id) => (window as any).game.world.dispatch({ type: 'stop', unitIds: [id] }), soldiers[0]);
  expect(await guardOf(page, soldiers[0])).toBeNull();
  expect(errors).toEqual([]);
});

test('phone: guard from the Orders sheet, then tap the unit', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'touch menus');
  const errors = await boot(page);
  await expect(page.locator('body')).toHaveClass(/touch/);
  const { soldiers, villager } = await cast(page);
  await page.evaluate((id) => (window as any).game.selection.set([id]), soldiers[0]);
  await page.locator('#menu-tabs [data-menu="orders"]').tap();
  const button = page.locator('#command-card [data-cmd="guard"]');
  await expect(button).toBeVisible();
  await button.tap();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  // Close the sheet so the next tap reaches the scene, as a player would.
  await page.locator('#menu-tabs [data-menu="orders"]').tap();
  const at = await screenPointOf(page, villager);
  await page.touchscreen.tap(at.x, at.y);
  await expect.poll(() => guardOf(page, soldiers[0]), { timeout: INPUT_TIMEOUT }).toBe(villager);
  expect(errors).toEqual([]);
});
