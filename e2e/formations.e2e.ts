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

/** Hotkeys and pointer input run in the game frame, which can lag on a loaded machine. */
const INPUT_TIMEOUT = 15_000;

/** Six swordsmen on open ground in view, selected; every dispatched command is recorded in `window.__cmds`. */
async function squad(page: Page): Promise<{ ids: number[]; spot: { x: number; z: number } }> {
  const out = await page.evaluate(() => {
    const g = (window as any).game;
    const tc = g.world.townCenter.pos;
    const spot = { x: tc.x - 28, z: tc.z - 16 };
    if (!g.rig.rts.hf.isWalkable(spot.x, spot.z)) throw new Error('squad spot is not walkable');
    g.rig.focusOn(spot);
    const ids = Array.from({ length: 6 }, (_, i) => g.world.spawnUnit('swordsman', { x: spot.x - 2 + (i % 3) * 1.4, z: spot.z + 3 + Math.floor(i / 3) * 1.4 }).id);
    g.selection.set(ids);
    const w = g.world;
    (window as any).__cmds = [];
    const dispatch = w.dispatch.bind(w);
    w.dispatch = (cmd: unknown, by?: number) => {
      if (by === undefined || by === w.localPlayer) (window as any).__cmds.push(cmd);
      return dispatch(cmd, by);
    };
    return { ids, spot };
  });
  await page.waitForFunction(() => (window as any).game.renderer.webgl.info.render.frame > 6);
  return out;
}

/**
 * Free ground ahead of the squad that projects onto bare canvas, as client px: `n` points
 * (the first is the anchor) spread along x at `dz` metres from the squad spot.
 */
async function groundAhead(page: Page, spot: { x: number; z: number }, offsets: { dx: number; dz: number }[], strict = true): Promise<{ x: number; z: number; sx: number; sy: number }[]> {
  const pts = await page.evaluate(({ spot, offsets }) => {
    const g = (window as any).game;
    const cam = g.rig.camera;
    cam.updateMatrixWorld(true);
    const canvas = document.querySelector('canvas')!;
    const rect = canvas.getBoundingClientRect();
    return offsets.map(({ dx, dz }) => {
      const x = spot.x + dx;
      const z = spot.z + dz;
      if (!g.rig.rts.hf.isWalkable(x, z)) return null;
      const v = cam.position.clone();
      v.set(x, Math.max(0, g.rig.rts.hf.heightAt(x, z)), z);
      v.project(cam);
      const sx = rect.left + ((v.x + 1) / 2) * canvas.clientWidth;
      const sy = rect.top + ((1 - v.y) / 2) * canvas.clientHeight;
      if (document.elementFromPoint(sx, sy) !== canvas) return null;
      const ndc = { x: ((sx - rect.left) / canvas.clientWidth) * 2 - 1, y: -((sy - rect.top) / canvas.clientHeight) * 2 + 1 };
      if (g.views.pick(ndc, cam) !== null) return null;
      return { x, z, sx, sy };
    });
  }, { spot, offsets });
  if (strict) expect(pts.every(Boolean), `ground points ${JSON.stringify(pts)} should be bare and on screen`).toBe(true);
  return pts as { x: number; z: number; sx: number; sy: number }[];
}

/** Any `n` bare, on-screen ground points at least 4 m apart around the squad (a phone shows little map). */
async function someGround(page: Page, spot: { x: number; z: number }, n: number): Promise<{ x: number; z: number; sx: number; sy: number }[]> {
  const found: { x: number; z: number; sx: number; sy: number }[] = [];
  for (const dz of [-4, -7, -10, 2, -2]) {
    for (const dx of [-6, 6, -3, 3, 0, -9, 9]) {
      if (found.length >= n) return found;
      const [p] = await groundAhead(page, spot, [{ dx, dz }], false);
      if (p && found.every((q) => Math.hypot(q.x - p.x, q.z - p.z) >= 4)) found.push(p);
    }
  }
  expect(found.length, 'enough bare ground on screen').toBe(n);
  return found;
}

const lastCommand = (page: Page) => page.evaluate(() => {
  const cmds = (window as any).__cmds as { type: string }[];
  return cmds.length ? cmds[cmds.length - 1] : null;
});

/** Wait until the game has drawn `n` more frames, so a held pointer state is seen by Controls. */
async function frames(page: Page, n = 2): Promise<void> {
  const start = await page.evaluate(() => (window as any).game.renderer.webgl.info.render.frame);
  await page.waitForFunction((f) => (window as any).game.renderer.webgl.info.render.frame >= f, start + n, { timeout: INPUT_TIMEOUT });
}

test('desktop: formation picker, hotkeys, and a right-drag that previews slots then moves with facing and width', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'mouse and keyboard');
  const errors = await boot(page);
  const { ids, spot } = await squad(page);

  const group = page.locator('#command-card .formation-group');
  await expect(group).toBeVisible();
  const btn = (kind: string) => page.locator(`#command-card [data-formation="${kind}"]`);
  // Soldiers default to Line.
  await expect(btn('line')).toHaveAttribute('aria-pressed', 'true', { timeout: INPUT_TIMEOUT });
  // Shift+C picks Column; Shift+X Box (not Stop); the button picks Line again.
  await page.keyboard.press('Shift+KeyC');
  await expect(btn('column')).toHaveAttribute('aria-pressed', 'true', { timeout: INPUT_TIMEOUT });
  await page.keyboard.press('Shift+KeyX');
  await expect(btn('box')).toHaveAttribute('aria-pressed', 'true', { timeout: INPUT_TIMEOUT });
  expect(await page.evaluate(() => (window as any).__cmds.some((c: { type: string }) => c.type === 'stop'))).toBe(false);
  await btn('line').click();
  await expect(btn('line')).toHaveAttribute('aria-pressed', 'true');
  // The touch-only "Draw line" button stays out of the mouse layout.
  await expect(page.locator('#command-card [data-cmd="formationDraw"]')).toBeHidden();

  // Right-drag a front line across, ahead of the squad (north of it on screen).
  const [a, b] = await groundAhead(page, spot, [{ dx: -6, dz: -12 }, { dx: 6, dz: -12 }]);
  const target0 = await page.evaluate(() => ({ ...(window as any).game.rig.rts.target }));
  await page.mouse.move(a.sx, a.sy);
  await page.mouse.down({ button: 'right' });
  await frames(page);
  await page.mouse.move((a.sx + b.sx) / 2, (a.sy + b.sy) / 2, { steps: 4 });
  await page.mouse.move(b.sx, b.sy, { steps: 4 });
  // Ghost slots show before release, one per soldier, and nothing has been ordered yet.
  await expect.poll(() => page.evaluate(() => (window as any).game.views.orders.slotCount), { timeout: INPUT_TIMEOUT }).toBe(ids.length);
  expect(await lastCommand(page)).toBeNull();
  await page.mouse.up({ button: 'right' });

  await expect.poll(() => lastCommand(page).then((c) => c?.type ?? null), { timeout: INPUT_TIMEOUT }).toBe('move');
  const cmd = await lastCommand(page) as any;
  expect(cmd.formation).toBe('line');
  expect(cmd.unitIds.sort()).toEqual([...ids].sort());
  expect(cmd.width).toBeGreaterThan(8);
  expect(cmd.width).toBeLessThan(16);
  // Facing away from the squad: towards −z (π), give or take.
  expect(Math.abs(Math.abs(cmd.facing) - Math.PI)).toBeLessThan(0.3);
  expect(cmd.target.x).toBeCloseTo((a.x + b.x) / 2, 0);
  expect(cmd.target.z).toBeCloseTo((a.z + b.z) / 2, 0);
  // The camera did not pan with the drag.
  const target1 = await page.evaluate(() => ({ ...(window as any).game.rig.rts.target }));
  expect(Math.hypot(target1.x - target0.x, target1.z - target0.z)).toBeLessThan(0.5);

  // Preview gone; the walk shows as route lines on the ground.
  await expect.poll(() => page.evaluate(() => (window as any).game.views.orders.slotCount), { timeout: INPUT_TIMEOUT }).toBe(0);
  await expect.poll(() => page.evaluate(() => (window as any).game.views.orders.segmentCount), { timeout: INPUT_TIMEOUT }).toBeGreaterThan(0);

  // A plain right-click still moves, now with the picked formation.
  await page.locator('#command-card [data-formation="column"]').click();
  await page.mouse.click(a.sx, a.sy, { button: 'right' });
  await expect.poll(() => lastCommand(page).then((c: any) => c && c.type === 'move' && c.formation === 'column' && c.width === undefined), { timeout: INPUT_TIMEOUT }).toBe(true);

  // Hotkey help lists the formation keys and the drag.
  const help = await page.locator('#hotkey-list').textContent();
  expect(help).toContain('Line formation');
  expect(help).toContain('RMB drag');
  expect(errors).toEqual([]);
});

/** A one-finger drag through Chrome's touch emulation (real pointer events, as a phone sends). */
async function touchDrag(page: Page, from: { sx: number; sy: number }, to: { sx: number; sy: number }): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const point = (p: { sx: number; sy: number }) => [{ x: p.sx, y: p.sy, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(from) });
  for (let i = 1; i <= 8; i++) {
    const p = { sx: from.sx + ((to.sx - from.sx) * i) / 8, sy: from.sy + ((to.sy - from.sy) * i) / 8 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(p) });
    await frames(page, 1);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test('phone: pick a formation, draw the line, patrol through several taps, train five', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'touch menus');
  const errors = await boot(page);
  await expect(page.locator('body')).toHaveClass(/touch/);
  const { ids, spot } = await squad(page);
  const orders = page.locator('#menu-tabs [data-menu="orders"]');

  // Formation from the Orders sheet.
  await orders.tap();
  const column = page.locator('#command-card [data-formation="column"]');
  await expect(column).toBeVisible();
  await column.tap();
  await expect(column).toHaveAttribute('aria-pressed', 'true', { timeout: INPUT_TIMEOUT });

  // Draw line: the next drag lays the front (the sheet closes so the map is free).
  await page.locator('#command-card [data-cmd="formationDraw"]').tap();
  await expect(page.locator('#select-hint')).toBeVisible({ timeout: INPUT_TIMEOUT });
  const [a, b] = await groundAhead(page, spot, [{ dx: -4, dz: -10 }, { dx: 4, dz: -10 }]);
  await touchDrag(page, a, b);
  await expect.poll(() => lastCommand(page).then((c: any) => c?.type ?? null), { timeout: INPUT_TIMEOUT }).toBe('move');
  const drawn = await lastCommand(page) as any;
  expect(drawn.formation).toBe('column');
  expect(drawn.width).toBeGreaterThan(4);
  expect(Number.isFinite(drawn.facing)).toBe(true);

  // Patrol: Orders → Patrol, close the sheet, tap two points, then ✓.
  await orders.tap();
  await page.locator('#command-card [data-cmd="patrol"]').tap();
  await expect(page.locator('#command-card [data-cmd="patrol"]')).toHaveAttribute('aria-pressed', 'true', { timeout: INPUT_TIMEOUT });
  await orders.tap();
  const bar = page.locator('#route-bar');
  await expect(bar).toBeVisible({ timeout: INPUT_TIMEOUT });
  const [p1, p2] = await someGround(page, spot, 2);
  await page.touchscreen.tap(p1.sx, p1.sy);
  await expect(page.locator('#route-count')).toContainText('1 point', { timeout: INPUT_TIMEOUT });
  await page.touchscreen.tap(p2.sx, p2.sy);
  await expect(page.locator('#route-count')).toContainText('2 points', { timeout: INPUT_TIMEOUT });
  // Nothing is ordered until ✓; the points chosen so far are drawn.
  expect(await page.evaluate((id) => (window as any).game.world.units.get(id).patrol ?? null, ids[0])).toBeNull();
  await expect.poll(() => page.evaluate(() => (window as any).game.views.orders.segmentCount), { timeout: INPUT_TIMEOUT }).toBeGreaterThan(0);
  await page.locator('#route-confirm').tap();
  await expect(bar).toBeHidden({ timeout: INPUT_TIMEOUT });
  await expect.poll(() => page.evaluate((ids) => ids.every((id: number) => (window as any).game.world.units.get(id).patrol?.route.length === 3), ids), { timeout: INPUT_TIMEOUT }).toBe(true);

  // Training: the ×5 toggle makes one tap queue five.
  const barracks = await page.evaluate(() => {
    const g = (window as any).game;
    (window as any).dev.give({ food: 2000, wood: 2000, gold: 2000 });
    // Room for five more on top of the squad.
    for (let i = 0; i < 3; i++) (window as any).dev.placeComplete('house');
    const id = (window as any).dev.placeComplete('barracks');
    g.selection.set([id]);
    return id;
  });
  expect(barracks).not.toBeNull();
  await page.locator('#menu-tabs [data-menu="train"]').tap();
  const x5 = page.locator('#train-grid [data-train-batch]');
  await expect(x5).toBeVisible({ timeout: INPUT_TIMEOUT });
  await x5.tap();
  await expect(x5).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#train-grid [data-train]').first().tap();
  await expect.poll(() => page.evaluate((id) => (window as any).game.world.buildings.get(id).queue, barracks), { timeout: INPUT_TIMEOUT }).toBe(5);
  expect(errors).toEqual([]);
});
