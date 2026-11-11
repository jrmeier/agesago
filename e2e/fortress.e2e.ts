import { expect, test, type Page } from '@playwright/test';

/** M16-5: the build menu shows the fortress limit, and a fortress trains its civ's champions. */

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

const CHAMPIONS = ['spartanHoplite', 'agema', 'praetorian', 'equites', 'appleBearer', 'savaran', 'gaesatae', 'nobleRider'];

test('fortress limit shows in the build menu and the fortress trains champions', async ({ page }, testInfo) => {
  const errors = await boot(page);
  const fortress = page.locator('#build-grid [data-build="fortress"]');

  await page.evaluate(() => {
    const w = window as any;
    w.dev.give({ food: 5000, wood: 5000, gold: 5000, stone: 5000 });
    w.dev.setAge(2);
    const g = w.game;
    const villagers = [...g.world.units.values()]
      .filter((u: any) => u.kind === 'villager' && u.owner === g.world.localPlayer)
      .map((u: any) => u.id);
    g.selection.set(villagers);
  });
  await expect(fortress.locator('.build-limit')).toHaveText('0/2');
  if (testInfo.project.name === 'desktop') {
    // The extra tile must not grow the menu over the middle of the map or past the screen.
    const layout = await page.evaluate(() => {
      const grid = document.getElementById('build-grid')!.getBoundingClientRect();
      const canvas = document.querySelector('#game-container canvas')!;
      return {
        centre: document.elementFromPoint(innerWidth / 2, innerHeight / 2) === canvas,
        inside: grid.left >= 0 && grid.right <= innerWidth && grid.bottom <= innerHeight,
      };
    });
    expect(layout).toEqual({ centre: true, inside: true });
  }
  await expect(fortress).toHaveAttribute('data-locked', 'false');

  const ids = await page.evaluate(() => {
    const w = window as any;
    return [w.dev.placeComplete('fortress'), w.dev.placeComplete('fortress')];
  });
  expect(ids.every((id) => id !== null)).toBe(true);
  await expect(fortress.locator('.build-limit')).toHaveText('2/2');
  await expect(fortress).toHaveAttribute('data-locked', 'true');
  await expect(fortress.locator('.build-lock')).toHaveText('Limit reached (2/2)');

  // The sim refuses a third one even if the menu were bypassed.
  const reason = await page.evaluate(() => {
    const g = (window as any).game;
    const w = g.world;
    let seen: string | null = null;
    w.events.on('rejected', (e: any) => { seen = e.reason; });
    const v = [...w.units.values()].find((u: any) => u.kind === 'villager' && u.owner === w.localPlayer) as any;
    w.dispatch({ type: 'build', unitIds: [v.id], kind: 'fortress', pos: { x: v.pos.x + 12, z: v.pos.z }, rot: 0 });
    return seen;
  });
  expect(reason).toBe('limit');

  await page.evaluate((id) => (window as any).game.selection.set([id]), ids[0]);
  const tiles = page.locator('#train-grid [data-train]');
  await expect(tiles).toHaveCount(2);
  for (const kind of await tiles.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.train))) {
    expect(CHAMPIONS).toContain(kind);
  }
  expect(errors).toEqual([]);
});
