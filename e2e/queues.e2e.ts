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

/** A mouse click on the phone project clears `body.touch`. Use a tap there. */
async function activate(page: Page, selector: string, phone: boolean): Promise<void> {
  const loc = page.locator(selector);
  if (phone) await loc.tap();
  else await loc.click();
}

/** Canvas CSS point for a ground position, plus whether that pixel is the map rather than a HUD control. */
async function canvasPoint(page: Page, x: number, z: number): Promise<{ x: number; y: number; onMap: boolean }> {
  return page.evaluate(({ x, z }) => {
    const g = (window as any).game;
    const cam = g.rig.camera;
    cam.updateMatrixWorld(true);
    const y = Math.max(0, g.rig.rts.hf.heightAt(x, z));
    const v = cam.position.clone();
    v.set(x, y + 1.2, z);
    v.project(cam);
    const canvas = document.querySelector('canvas')!;
    const rect = canvas.getBoundingClientRect();
    const sx = rect.left + ((v.x + 1) / 2) * canvas.clientWidth;
    const sy = rect.top + ((1 - v.y) / 2) * canvas.clientHeight;
    const el = document.elementFromPoint(sx, sy);
    return { x: sx, y: sy, onMap: el === canvas };
  }, { x, z });
}

test('queue cancel, the rally flag, and the idle badge work', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'phone';
  const errors = await boot(page);
  if (phone) await expect(page.locator('body')).toHaveClass(/touch/);

  const idle = page.locator('#idle-btn');
  await expect(idle).toBeVisible();
  const idleBox = await idle.boundingBox();
  expect(idleBox && idleBox.width >= (phone ? 44 : 36)).toBe(true);
  await expect(idle.locator('.idle-count')).not.toHaveText('0');

  await activate(page, '#idle-btn', phone);
  const selected = await page.evaluate(() => {
    const g = (window as any).game;
    const id = [...g.selection.ids][0];
    const u = g.world.units.get(id);
    return u ? { kind: u.kind, state: u.state } : null;
  });
  expect(selected).toEqual({ kind: 'villager', state: 'idle' });

  if (phone) {
    await page.locator('#touch-deselect').tap();
    await expect(page.locator('body')).toHaveClass(/touch/);
  } else {
    // The villager build panel (15 buildings since M8) reaches the middle of a 1280×800 view.
    await page.evaluate(() => (window as any).game.selection.set([]));
  }
  await expect(page.locator('#selection-panel')).toHaveClass(/hidden/);

  const tc = await page.evaluate(() => {
    const g = (window as any).game;
    const b = g.world.townCenter;
    g.rig.focusOn(b.pos);
    return { id: b.id, x: b.pos.x, z: b.pos.z };
  });
  const town = await canvasPoint(page, tc.x, tc.z);
  expect(town.onMap).toBe(true);
  if (phone) await page.touchscreen.tap(town.x, town.y);
  else await page.mouse.click(town.x, town.y);

  await expect.poll(() => page.evaluate(() => [...(window as any).game.selection.ids])).toEqual([tc.id]);

  // A ground point that is on the map, clear of units, and not covered by a HUD control.
  const ground = await page.evaluate(() => {
    const g = (window as any).game;
    const b = g.world.townCenter;
    const cam = g.rig.camera;
    cam.updateMatrixWorld(true);
    const canvas = document.querySelector('canvas')!;
    const rect = canvas.getBoundingClientRect();
    const units = [...g.world.units.values()] as { pos: { x: number; z: number } }[];
    for (let r = 8; r <= 18; r += 2) {
      for (let i = 0; i < 12; i++) {
        const ang = (Math.PI * 2 * i) / 12;
        const x = b.pos.x + Math.cos(ang) * r;
        const z = b.pos.z + Math.sin(ang) * r;
        if (units.some((u) => Math.hypot(u.pos.x - x, u.pos.z - z) < 2)) continue;
        const y = Math.max(0, g.rig.rts.hf.heightAt(x, z));
        const v = cam.position.clone();
        v.set(x, y + 0.4, z);
        v.project(cam);
        if (v.z < -1 || v.z > 1) continue;
        const sx = rect.left + ((v.x + 1) / 2) * canvas.clientWidth;
        const sy = rect.top + ((1 - v.y) / 2) * canvas.clientHeight;
        if (sx < rect.left + 12 || sy < rect.top + 12 || sx > rect.right - 12 || sy > rect.bottom - 12) continue;
        if (document.elementFromPoint(sx, sy) !== canvas) continue;
        return { x: sx, y: sy };
      }
    }
    return null;
  });
  expect(ground).toBeTruthy();
  if (phone) await page.touchscreen.tap(ground!.x, ground!.y);
  else await page.mouse.click(ground!.x, ground!.y, { button: 'right' });

  await expect(page.locator('#rally-flag')).toBeVisible();
  const rally = await page.evaluate(() => (window as any).game.world.townCenter.rally?.pos ?? null);
  expect(rally).toBeTruthy();

  // A match starts with an empty stockpile. Put food in so the queue control can be used.
  await page.evaluate(() => {
    (window as any).game.world.stock.food = 200;
  });
  await expect(page.locator('#train-btn')).toBeEnabled();
  await activate(page, '#train-btn', phone);
  if (phone) {
    await page.locator('#menu-tabs [data-menu="train"]').tap();
    await expect(page.locator('body')).toHaveClass(/menu-train/);
  }
  const queued = page.locator('#train-queue .queue-item');
  await expect(queued).toHaveCount(1);
  await expect(queued).toBeVisible();
  if (phone) {
    const q = await queued.boundingBox();
    expect(q && q.width >= 44 && q.height >= 44).toBe(true);
  }

  const before = await page.evaluate(() => (window as any).game.world.stock.food as number);
  await activate(page, '#train-queue .queue-item', phone);
  await expect(queued).toHaveCount(0);
  const after = await page.evaluate(() => (window as any).game.world.stock.food as number);
  expect(after - before).toBe(50);
  if (phone) await expect(page.locator('body')).toHaveClass(/touch/);
  expect(errors).toEqual([]);
});
