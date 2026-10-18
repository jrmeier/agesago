import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page): Promise<void> {
  await page.goto('/?e2e&quality=low');
  await page.waitForFunction(() => (window as any).game?.renderer?.webgl?.info?.render?.frame > 2);
  await page.locator('#loading').waitFor({ state: 'detached' });
}

async function selectVillager(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = (window as any).game;
    const unit = [...g.world.units.values()].find((u: any) => u.kind === 'villager' && u.owner === g.world.localPlayer);
    g.selection.set([(unit as any).id]);
  });
  await expect(page.locator('#selection-panel')).not.toHaveClass(/\bhidden\b/);
  await page.locator('#selection-panel').evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((a) => a.finished));
  });
}

test('portrait leaves most of the battlefield available with a unit selected', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'touch layout');
  await page.setViewportSize({ width: 390, height: 744 });
  await boot(page);
  await selectVillager(page);

  const space = await page.evaluate(() => {
    const top = document.querySelector('.hud-top')!.getBoundingClientRect();
    const panel = document.querySelector('#selection-panel')!.getBoundingClientRect();
    const dock = document.querySelector('.hud-bottom')!.getBoundingClientRect();
    const canvas = document.querySelector('#game-container canvas');
    // This central strip is where a player selects units, orders movement and pans.
    const clear = Array.from({ length: 9 }, (_, i) => {
      const y = top.bottom + 12 + (panel.top - top.bottom - 24) * i / 8;
      return document.elementFromPoint(innerWidth / 2, y) === canvas;
    });
    return { header: top.height, summary: panel.height, dock: dock.height,
      freeHeight: panel.top - top.bottom, viewportHeight: innerHeight, clear };
  });
  expect(space.header).toBeLessThanOrEqual(60);
  expect(space.summary).toBeLessThanOrEqual(120);
  expect(space.dock).toBeLessThanOrEqual(64);
  expect(space.freeHeight / space.viewportHeight).toBeGreaterThanOrEqual(0.65);
  expect(space.clear.every(Boolean)).toBe(true);
  await expect(page.locator('.minimap')).toHaveClass(/collapsed/);
  await expect(page.locator('#save-copy')).toBeHidden();
  await expect(page.locator('#open-file')).toBeHidden();
  await expect(page.locator('#new-match')).toBeHidden();
  await expect(page.locator('#resign-btn')).toBeHidden();
});

test('rotating a phone keeps its map and primary tools reachable', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'touch layout');
  await page.setViewportSize({ width: 390, height: 744 });
  await boot(page);
  await selectVillager(page);

  for (const viewport of [{ width: 844, height: 390 }, { width: 360, height: 640 }]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const top = document.querySelector('.hud-top')!.getBoundingClientRect();
      const panel = document.querySelector('#selection-panel')!.getBoundingClientRect();
      return { clearHeight: panel.top - top.bottom, height: innerHeight,
        overflow: document.documentElement.scrollWidth - innerWidth };
    });
    expect(layout.overflow).toBeLessThanOrEqual(0);
    expect(layout.clearHeight / layout.height).toBeGreaterThanOrEqual(viewport.height < 460 ? 0.53 : 0.58);
    for (const selector of ['#touch-box', '#touch-select-all', '#touch-deselect', '#touch-fps', '#pause-match']) {
      const control = page.locator(selector);
      await expect(control).toBeInViewport();
      const rect = await control.boundingBox();
      expect(rect!.width).toBeGreaterThanOrEqual(44);
      expect(rect!.height).toBeGreaterThanOrEqual(44);
    }
  }
});

test('UI scale keeps the phone HUD anchored and touch controls reachable', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'touch layout');
  await page.setViewportSize({ width: 360, height: 640 });
  await boot(page);
  await selectVillager(page);

  for (const scale of ['0.85', '1.15', '1.3']) {
    await page.evaluate((value) => document.documentElement.style.setProperty('--ui-scale', value), scale);
    const geometry = await page.evaluate(() => {
      const hud = document.getElementById('hud')!.getBoundingClientRect();
      const dock = document.querySelector('.hud-bottom')!.getBoundingClientRect();
      const selectors = ['#pause-match', '#touch-box', '#touch-select-all', '#touch-deselect', '#touch-fps', '#train-btn'];
      return { hud: { width: hud.width, height: hud.height }, dockBottom: dock.bottom,
        controls: selectors.map((selector) => {
          const el = document.querySelector(selector)!;
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { selector, width: r.width, height: r.height, left: r.left, right: r.right,
            bottom: r.bottom, reachable: hit === el || el.contains(hit) };
        }) };
    });
    expect(geometry.hud.width, `${scale}: HUD width`).toBeCloseTo(360, 0);
    expect(geometry.hud.height, `${scale}: HUD height`).toBeCloseTo(640, 0);
    expect(geometry.dockBottom, `${scale}: dock bottom`).toBeCloseTo(640, 0);
    for (const control of geometry.controls) {
      expect(control.left, `${scale}: ${control.selector} left`).toBeGreaterThanOrEqual(0);
      expect(control.right, `${scale}: ${control.selector} right`).toBeLessThanOrEqual(360);
      expect(control.bottom, `${scale}: ${control.selector} bottom`).toBeLessThanOrEqual(640);
      expect(control.width, `${scale}: ${control.selector} width`).toBeGreaterThanOrEqual(43.9);
      expect(control.height, `${scale}: ${control.selector} height`).toBeGreaterThanOrEqual(43.9);
      expect(control.reachable, `${scale}: ${control.selector} reachable`).toBe(true);
    }
  }
});
