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

interface ScreenPoint {
  x: number;
  y: number;
}

interface DragPlan {
  from: ScreenPoint;
  to: ScreenPoint;
  segments: number;
  onCanvas: boolean;
  hit: string;
}

/**
 * Stock wood, select the villagers, and aim the camera at a run of palisade
 * spots the sim will accept. Returns the two drag ends in viewport CSS px.
 */
async function planPalisadeDrag(page: Page): Promise<DragPlan> {
  return page.evaluate(() => {
    const g = (window as any).game;
    const w = g.world;
    w.stock.wood = 800;
    const villagers = [...w.units.values()]
      .filter((u: any) => u.kind === 'villager' && u.owner === w.localPlayer)
      .map((u: any) => u.id);
    g.selection.set(villagers);

    const tc = w.townCenter.pos;
    const snap = (n: number) => Math.round(n * 2) / 2;
    let line: { x: number; z: number }[] | null = null;
    for (const n of [4, 3, 2]) {
      for (const horizontal of [true, false]) {
        for (let dz = -10; dz <= 10 && !line; dz++) {
          for (let dx = -10; dx <= 10 && !line; dx++) {
            const spots = Array.from({ length: n }, (_, i) =>
              horizontal
                ? { x: snap(tc.x + dx) + i * 2, z: snap(tc.z + dz) }
                : { x: snap(tc.x + dx), z: snap(tc.z + dz) + i * 2 },
            );
            if (spots.every((p) => w.canPlace('palisade', p, 0).ok)) line = spots;
          }
        }
      }
      if (line) break;
    }
    if (!line) return { from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, segments: 0, onCanvas: false, hit: 'no legal palisade line' };

    const mid = line[Math.floor(line.length / 2)]!;
    g.rig.focusOn(mid);
    const cam = g.rig.camera;
    cam.updateMatrixWorld(true);

    const apply = (e: number[], x: number, y: number, z: number) => {
      const inv = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
      return {
        x: (e[0] * x + e[4] * y + e[8] * z + e[12]) * inv,
        y: (e[1] * x + e[5] * y + e[9] * z + e[13]) * inv,
        z: (e[2] * x + e[6] * y + e[10] * z + e[14]) * inv,
      };
    };
    const canvas = document.querySelector('#game-container canvas') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const project = (p: { x: number; z: number }) => {
      const y = Math.max(0, w.hf.heightAt(p.x, p.z));
      const view = apply(cam.matrixWorldInverse.elements, p.x, y, p.z);
      const clip = apply(cam.projectionMatrix.elements, view.x, view.y, view.z);
      return {
        x: rect.left + ((clip.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - clip.y) / 2) * rect.height,
        behind: clip.z > 1,
      };
    };
    const from = project(line[0]!);
    const to = project(line[line.length - 1]!);
    return {
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      segments: line.length,
      onCanvas: !from.behind && !to.behind,
      hit: from.behind || to.behind ? 'behind the camera' : 'in view',
    };
  });
}

/** Topmost element under a viewport point, once placement has dismissed the selection panel. */
async function hitAt(page: Page, p: ScreenPoint): Promise<string> {
  return page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y);
    const canvas = document.querySelector('#game-container canvas');
    if (hit === canvas) return 'canvas';
    return `${hit?.tagName ?? 'none'}#${hit?.id ?? ''}.${hit?.className ?? ''}`;
  }, p);
}

test('dragging a palisade lays segments and blocks the nav grid', async ({ page }, testInfo) => {
  const errors = await boot(page);
  const plan = await planPalisadeDrag(page);
  expect(plan.segments, plan.hit).toBeGreaterThanOrEqual(2);
  expect(plan.onCanvas, `${plan.hit} @ ${JSON.stringify(plan)}`).toBe(true);
  expect(Math.hypot(plan.to.x - plan.from.x, plan.to.y - plan.from.y)).toBeGreaterThan(40);

  await page.keyboard.press('l');
  await expect(page.locator('body')).toHaveClass(/placing-line/);
  await expect(page.locator('.place-help-line')).toBeVisible();
  const mid = { x: (plan.from.x + plan.to.x) / 2, y: (plan.from.y + plan.to.y) / 2 };
  const hits = await Promise.all([hitAt(page, plan.from), hitAt(page, mid), hitAt(page, plan.to)]);
  expect(hits, JSON.stringify(plan)).toEqual(['canvas', 'canvas', 'canvas']);

  const touch = !!testInfo.project.use.hasTouch;
  if (touch) {
    const client = await page.context().newCDPSession(page);
    const point = (x: number, y: number) => ({ x: Math.round(x), y: Math.round(y), radiusX: 1, radiusY: 1, id: 1 });
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(plan.from.x, plan.from.y)] });
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [point(plan.from.x + (plan.to.x - plan.from.x) * t, plan.from.y + (plan.to.y - plan.from.y) * t)],
      });
    }
    await expect(page.locator('#place-reason')).toContainText(/segments?/);
    const ghosts = await page.evaluate(
      () => ((window as any).game.views.lineGhosts as { visible: boolean }[]).filter((g) => g.visible).length,
    );
    expect(ghosts).toBeGreaterThanOrEqual(2);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await client.detach();
  } else {
    // Release is applied on the next animation frame. A background tab (the suite
    // runs several pages at once) can pause those frames, so keep this page in front.
    await page.bringToFront();
    await page.mouse.move(plan.from.x, plan.from.y);
    await page.mouse.down();
    await page.mouse.move(plan.to.x, plan.to.y, { steps: 16 });
    await page.bringToFront();
    await expect(page.locator('#place-reason')).toContainText(/segments?/);
    const ghosts = await page.evaluate(
      () => ((window as any).game.views.lineGhosts as { visible: boolean }[]).filter((g) => g.visible).length,
    );
    expect(ghosts).toBeGreaterThanOrEqual(2);
    await page.mouse.up();
    await page.bringToFront();
  }

  await page.waitForFunction(
    () => [...(window as any).game.world.buildings.values()].filter((b: { kind: string }) => b.kind === 'palisade').length >= 2,
    null,
    { timeout: 8_000 },
  );
  await expect(page.locator('body')).not.toHaveClass(/placing/);
  const placed = await page.evaluate(() => {
    const w = (window as any).game.world;
    const pals = [...w.buildings.values()].filter((b: any) => b.kind === 'palisade');
    const xs = pals.map((b: any) => b.pos.x);
    const zs = pals.map((b: any) => b.pos.z);
    const aligned = xs.every((x: number) => x === xs[0]) || zs.every((z: number) => z === zs[0]);
    return {
      count: pals.length,
      blocked: pals.every((b: any) => w.nav.isWalkableCell(b.pos) === false),
      aligned,
      wood: w.stock.wood as number,
    };
  });
  expect(placed.count).toBeGreaterThanOrEqual(2);
  expect(placed.blocked).toBe(true);
  expect(placed.aligned).toBe(true);
  expect(placed.wood).toBeLessThan(800);
  expect(errors).toEqual([]);
});
