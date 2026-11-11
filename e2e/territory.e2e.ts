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
 * Explore the map, select the villagers, and aim the camera at a clear spot just past the
 * home borders (neutral land) and a clear spot inside them. Returns both in viewport CSS px.
 */
async function planSpots(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).game;
    const w = g.world;
    w.visibility.state.fill(2);
    w.stock.wood = 500;
    g.selection.set([...w.units.values()].filter((u: any) => u.kind === 'villager' && u.owner === w.localPlayer).map((u: any) => u.id));
    const tc = w.townCenter.pos;
    const find = (want: (r: { ok: boolean; reason?: string }) => boolean, from: number, to: number) => {
      for (let r = from; r <= to; r++) {
        for (let i = 0; i < 32; i++) {
          const a = (i / 32) * Math.PI * 2;
          const p = { x: Math.round((tc.x + Math.cos(a) * r) * 2) / 2, z: Math.round((tc.z + Math.sin(a) * r) * 2) / 2 };
          if (want(w.canPlace('house', p, 0))) return p;
        }
      }
      return null;
    };
    const outside = find((c) => c.reason === 'territory', 22, 34);
    if (!outside) return { error: 'no neutral house spot near the town' };
    // Inside: the closest legal spot on the same side, so both fit the view.
    const toward = { x: tc.x + (outside.x - tc.x) * 0.6, z: tc.z + (outside.z - tc.z) * 0.6 };
    let inside: { x: number; z: number } | null = null;
    for (let d = 0; d < 8 && !inside; d += 0.5) {
      for (let i = 0; i < 16 && !inside; i++) {
        const a = (i / 16) * Math.PI * 2;
        const p = { x: Math.round((toward.x + Math.cos(a) * d) * 2) / 2, z: Math.round((toward.z + Math.sin(a) * d) * 2) / 2 };
        if (w.canPlace('house', p, 0).ok) inside = p;
      }
    }
    if (!inside) return { error: 'no legal house spot inside the borders' };
    g.rig.focusOn({ x: (outside.x + inside.x) / 2, z: (outside.z + inside.z) / 2 });
    const cam = g.rig.camera;
    cam.updateMatrixWorld(true);
    const canvas = document.querySelector('#game-container canvas') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const apply = (e: number[], x: number, y: number, z: number) => {
      const inv = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
      return {
        x: (e[0] * x + e[4] * y + e[8] * z + e[12]) * inv,
        y: (e[1] * x + e[5] * y + e[9] * z + e[13]) * inv,
        z: (e[2] * x + e[6] * y + e[10] * z + e[14]) * inv,
      };
    };
    const project = (p: { x: number; z: number }) => {
      const y = Math.max(0, w.hf.heightAt(p.x, p.z));
      const view = apply(cam.matrixWorldInverse.elements, p.x, y, p.z);
      const clip = apply(cam.projectionMatrix.elements, view.x, view.y, view.z);
      return { x: rect.left + ((clip.x + 1) / 2) * rect.width, y: rect.top + ((1 - clip.y) / 2) * rect.height };
    };
    return { outside: project(outside), inside: project(inside), owner: w.territoryOwner(outside) };
  });
}

test('the placement ghost names the territory rule outside the borders', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'mouse placement');
  const errors = await boot(page);
  const plan = await planSpots(page);
  expect('error' in plan ? plan.error : '').toBe('');
  if ('error' in plan) return;
  expect(plan.owner).toBe(0);

  await page.keyboard.press('h');
  await expect(page.locator('#place-bar')).toBeVisible();
  await page.mouse.move(plan.outside.x, plan.outside.y, { steps: 4 });
  await expect(page.locator('#place-reason')).toHaveText('Must be in your territory');
  await expect(page.locator('#place-bar')).toHaveClass(/invalid/);
  await testInfo.attach('territory-ghost', { body: await page.screenshot(), contentType: 'image/png' });

  // A click there places nothing.
  const before = await page.evaluate(() => (window as any).game.world.buildings.size);
  await page.mouse.click(plan.outside.x, plan.outside.y);
  expect(await page.evaluate(() => (window as any).game.world.buildings.size)).toBe(before);

  // Back inside the borders the ghost is valid again.
  await page.mouse.move(plan.inside.x, plan.inside.y, { steps: 4 });
  await expect(page.locator('#place-bar')).not.toHaveClass(/invalid/);
  await expect(page.locator('#place-reason')).toHaveText('');
  expect(errors).toEqual([]);
});
