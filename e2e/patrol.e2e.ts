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

/** Free, walkable ground points around `id` that project onto the bare canvas, one per bearing. */
async function groundPoints(page: Page, id: number, n: number): Promise<{ x: number; z: number; sx: number; sy: number }[]> {
  return page.evaluate(({ id, n }) => {
    const g = (window as any).game;
    const s = g.world.units.get(id);
    const cam = g.rig.camera;
    cam.updateMatrixWorld(true);
    const canvas = document.querySelector('canvas')!;
    const rect = canvas.getBoundingClientRect();
    const units = [...g.world.units.values()] as { pos: { x: number; z: number } }[];
    const found: { x: number; z: number; sx: number; sy: number }[] = [];
    for (let i = 0; i < 16 && found.length < n; i++) {
      const ang = (Math.PI * 2 * i) / 16;
      for (let r = 8; r <= 16; r += 2) {
        const x = s.pos.x + Math.cos(ang) * r;
        const z = s.pos.z + Math.sin(ang) * r;
        if (!g.rig.rts.hf.isWalkable(x, z) || !g.world.nav.isFree({ x, z })) continue;
        if (units.some((u) => Math.hypot(u.pos.x - x, u.pos.z - z) < 2.5)) continue;
        if (found.some((p) => Math.hypot(p.x - x, p.z - z) < 6)) continue;
        const v = cam.position.clone();
        v.set(x, Math.max(0, g.rig.rts.hf.heightAt(x, z)) + 0.4, z);
        v.project(cam);
        if (v.z < -1 || v.z > 1) continue;
        const sx = rect.left + ((v.x + 1) / 2) * canvas.clientWidth;
        const sy = rect.top + ((1 - v.y) / 2) * canvas.clientHeight;
        if (sx < rect.left + 80 || sy < rect.top + 80 || sx > rect.right - 80 || sy > rect.bottom - 200) continue;
        const ndc = { x: ((sx - rect.left) / canvas.clientWidth) * 2 - 1, y: -((sy - rect.top) / canvas.clientHeight) * 2 + 1 };
        if (g.views.pick(ndc, cam) !== null) continue;
        if (document.elementFromPoint(sx, sy) !== canvas) continue;
        found.push({ x, z, sx, sy });
        break;
      }
    }
    return found;
  }, { id, n });
}

/** Wait until the game has rendered `n` more frames (software WebGL frames can be slow). */
async function frames(page: Page, n = 2): Promise<void> {
  const start = await page.evaluate(() => (window as any).game.renderer.webgl.info.render.frame);
  await page.waitForFunction((f) => (window as any).game.renderer.webgl.info.render.frame >= f, start + n);
}

/** A real click: press and release on separate frames, as a player's would be. */
async function click(page: Page, p: { sx: number; sy: number }): Promise<void> {
  await page.mouse.move(p.sx, p.sy);
  await page.mouse.down();
  await frames(page);
  await page.mouse.up();
  await frames(page);
}

test('desktop: the Patrol button and Shift+Q hotkey order a looping patrol with Shift+click waypoints', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'mouse and keyboard');
  const errors = await boot(page);

  const cast = await page.evaluate(() => {
    const g = (window as any).game;
    const tc = g.world.townCenter.pos;
    const spot = { x: tc.x - 30, z: tc.z - 18 };
    if (!g.rig.rts.hf.isWalkable(spot.x, spot.z)) throw new Error('soldier spot is not walkable');
    g.rig.focusOn(spot);
    const soldier = g.world.spawnUnit('swordsman', spot);
    g.selection.set([soldier.id]);
    return { soldierId: soldier.id };
  });
  await page.waitForFunction(() => (window as any).game.renderer.webgl.info.render.frame > 4);

  const patrolBtn = page.locator('#command-card [data-cmd="patrol"]');
  await expect(patrolBtn).toBeVisible();

  // The hotkey arms patrol targeting; Escape disarms it without an order.
  await page.keyboard.press('Shift+KeyQ');
  await expect(patrolBtn).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(patrolBtn).toHaveAttribute('aria-pressed', 'false');
  // Plain Q is still attack-move, not patrol.
  await page.keyboard.press('q');
  await expect(page.locator('#command-card [data-cmd="attackMove"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(patrolBtn).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape');

  const pts = await groundPoints(page, cast.soldierId, 3);
  expect(pts.length).toBe(3);

  await patrolBtn.click();
  await expect(patrolBtn).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.down('Shift');
  await click(page, pts[0]);
  await click(page, pts[1]);
  await page.keyboard.up('Shift');
  // Still armed after the Shift+clicks; nothing is ordered until the final plain click.
  await expect(patrolBtn).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate((id) => (window as any).game.world.units.get(id).patrol ?? null, cast.soldierId)).toBeNull();
  await click(page, pts[2]);
  await expect(patrolBtn).toHaveAttribute('aria-pressed', 'false');

  await expect.poll(() => page.evaluate((id) => (window as any).game.world.units.get(id).patrol?.route.length ?? 0, cast.soldierId)).toBe(4);
  const ordered = await page.evaluate(({ id, pts }) => {
    const g = (window as any).game;
    const u = g.world.units.get(id);
    return {
      moving: u.state === 'moving',
      order: g.world.combatState.get(id)?.order ?? null,
      near: pts.map((p: { x: number; z: number }, i: number) => Math.hypot(u.patrol.route[i + 1].x - p.x, u.patrol.route[i + 1].z - p.z) < 4),
    };
  }, { id: cast.soldierId, pts });
  expect(ordered).toEqual({ moving: true, order: 'attackMove', near: [true, true, true] });

  // It walks the loop: the target index advances past the first waypoint.
  await expect.poll(() => page.evaluate((id) => (window as any).game.world.units.get(id).patrol?.index ?? -1, cast.soldierId), { timeout: 30_000 }).not.toBe(1);
  expect(errors).toEqual([]);
});
