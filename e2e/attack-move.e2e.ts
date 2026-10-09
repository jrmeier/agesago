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

/** Hold still past the long-press, then release. A drag would be a box instead. */
async function longPress(page: Page, x: number, y: number): Promise<void> {
  const client = await page.context().newCDPSession(page);
  const point = { x: Math.round(x), y: Math.round(y), radiusX: 1, radiusY: 1, id: 1 };
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await page.waitForTimeout(600);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
}

test('a phone long-press toggles an own unit and attack-moves soldiers', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'touch long-press');
  const errors = await boot(page);
  await expect(page.locator('body')).toHaveClass(/touch/);

  const cast = await page.evaluate(() => {
    const g = (window as any).game;
    const tc = g.world.townCenter.pos;
    const spot = { x: tc.x - 30, z: tc.z - 18 };
    if (!g.rig.rts.hf.isWalkable(spot.x, spot.z)) throw new Error('soldier spot is not walkable');
    g.rig.focusOn(spot);
    const soldier = g.world.spawnUnit('swordsman', spot);
    const villager = g.world.spawnUnit('villager', { x: spot.x + 2.4, z: spot.z + 0.2 });
    g.selection.set([soldier.id]);
    return { soldierId: soldier.id, villagerId: villager.id, x: spot.x, z: spot.z };
  });
  await page.waitForFunction(() => (window as any).game.renderer.webgl.info.render.frame > 4);

  const onSoldier = await page.evaluate((id) => {
    const g = (window as any).game;
    const canvas = document.querySelector('canvas')!;
    const rect = canvas.getBoundingClientRect();
    const u = g.world.units.get(id);
    const cam = g.rig.camera;
    cam.updateMatrixWorld(true);
    const y = Math.max(0, g.rig.rts.hf.heightAt(u.pos.x, u.pos.z)) + 1.1;
    const v = cam.position.clone();
    v.set(u.pos.x, y, u.pos.z);
    v.project(cam);
    const cx = ((v.x + 1) / 2) * canvas.clientWidth;
    const cy = ((1 - v.y) / 2) * canvas.clientHeight;
    for (let dy = -20; dy <= 28; dy += 4) {
      for (let dx = -16; dx <= 16; dx += 4) {
        const sx = cx + dx;
        const sy = cy + dy;
        const ndc = { x: (sx / canvas.clientWidth) * 2 - 1, y: -(sy / canvas.clientHeight) * 2 + 1 };
        if (g.views.pick(ndc, cam) !== id) continue;
        const clientX = rect.left + sx;
        const clientY = rect.top + sy;
        if (document.elementFromPoint(clientX, clientY) !== canvas) continue;
        return { x: clientX, y: clientY };
      }
    }
    return null;
  }, cast.soldierId);
  expect(onSoldier).toBeTruthy();

  await longPress(page, onSoldier!.x, onSoldier!.y);
  await expect.poll(() => page.evaluate((id) => (window as any).game.selection.has(id), cast.soldierId)).toBe(false);
  expect(await page.evaluate((id) => (window as any).game.world.combatState.get(id)?.order ?? null, cast.soldierId)).toBeNull();

  const aim = await page.evaluate(({ soldierId, villagerId }) => {
    const g = (window as any).game;
    g.selection.set([soldierId, villagerId]);
    const s = g.world.units.get(soldierId);
    const cam = g.rig.camera;
    cam.updateMatrixWorld(true);
    const canvas = document.querySelector('canvas')!;
    const rect = canvas.getBoundingClientRect();
    const units = [...g.world.units.values()] as { pos: { x: number; z: number } }[];
    for (let r = 6; r <= 16; r += 2) {
      for (let i = 0; i < 16; i++) {
        const ang = (Math.PI * 2 * i) / 16;
        const x = s.pos.x + Math.cos(ang) * r;
        const z = s.pos.z + Math.sin(ang) * r;
        if (!g.rig.rts.hf.isWalkable(x, z)) continue;
        if (units.some((u) => Math.hypot(u.pos.x - x, u.pos.z - z) < 2.5)) continue;
        const y = Math.max(0, g.rig.rts.hf.heightAt(x, z));
        const v = cam.position.clone();
        v.set(x, y + 0.4, z);
        v.project(cam);
        if (v.z < -1 || v.z > 1) continue;
        const sx = rect.left + ((v.x + 1) / 2) * canvas.clientWidth;
        const sy = rect.top + ((1 - v.y) / 2) * canvas.clientHeight;
        if (sx < rect.left + 12 || sy < rect.top + 12 || sx > rect.right - 12 || sy > rect.bottom - 12) continue;
        const ndc = { x: (sx - rect.left) / canvas.clientWidth * 2 - 1, y: -((sy - rect.top) / canvas.clientHeight) * 2 + 1 };
        if (g.views.pick(ndc, cam) !== null) continue;
        if (document.elementFromPoint(sx, sy) !== canvas) continue;
        return { x, z, sx, sy };
      }
    }
    return null;
  }, cast);
  expect(aim).toBeTruthy();

  await longPress(page, aim!.sx, aim!.sy);
  await expect.poll(() => page.evaluate((id) => (window as any).game.world.combatState.get(id)?.order ?? null, cast.soldierId)).toBe('attackMove');
  const ordered = await page.evaluate(({ soldierId, villagerId, x, z }) => {
    const g = (window as any).game;
    const dest = g.world.combatState.get(soldierId)?.dest;
    return {
      moving: g.world.units.get(soldierId).state === 'moving',
      villagerOrder: g.world.combatState.get(villagerId)?.order ?? null,
      near: !!dest && Math.hypot(dest.x - x, dest.z - z) < 4,
    };
  }, { soldierId: cast.soldierId, villagerId: cast.villagerId, x: aim.x, z: aim.z });
  expect(ordered).toEqual({ moving: true, villagerOrder: null, near: true });
  expect(errors).toEqual([]);
});
