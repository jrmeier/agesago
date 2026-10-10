import { expect, test, type Page } from '@playwright/test';

async function activate(page: Page, selector: string, phone: boolean): Promise<void> {
  const loc = page.locator(selector);
  if (phone) await loc.tap();
  else await loc.click();
}

test('the tutorial finishes from sim events, and a dismissed hint stays dismissed', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const phone = testInfo.project.name === 'phone';
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/');
  await page.setViewportSize({ width: 360, height: 640 });
  await expect(page.locator('#title-home')).toBeVisible();
  await activate(page, '#title-tutorial', phone);
  await page.waitForFunction(() => document.getElementById('tutorial')?.dataset.step === 'gather', null, { timeout: 30_000 });
  const skip = await page.locator('#tutorial-skip').boundingBox();
  expect(skip && skip.width >= 44 && skip.height >= 44).toBe(true);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const covered = await page.evaluate(() => {
    const train = document.querySelector('#train-btn');
    if (!train) return 'missing';
    const r = train.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit === train || train.contains(hit) ? '' : 'train';
  });
  expect(covered).toBe('');

  await activate(page, '#tutorial-dismiss', phone);
  await expect(page.locator('#tutorial-hint')).toBeHidden();
  const saved = await page.evaluate(() => localStorage.getItem('agesago-tutorial-hints'));
  expect(saved).toContain('gather');

  await activate(page, '#tutorial-skip', phone);
  await expect(page.locator('#title-home')).toBeVisible();
  await activate(page, '#title-tutorial', phone);
  await page.waitForFunction(() => document.getElementById('tutorial')?.dataset.step === 'gather', null, { timeout: 30_000 });
  await expect(page.locator('#tutorial-hint')).toBeHidden();

  await page.goto('/?e2e&tutorial=1');
  await page.waitForFunction(() => document.getElementById('tutorial')?.dataset.step === 'gather', null, { timeout: 30_000 });
  const started = Date.now();
  const finished = await page.evaluate(() => {
    const game = (window as unknown as {
      game: {
        world: {
          units: Map<number, { id: number; kind: string; owner: number; pos: { x: number; z: number } }>;
          nodes: Map<number, { id: number; kind: string }>;
          townCenter: { id: number };
          dispatch: (cmd: unknown, by?: number) => void;
        };
      };
      dev: { fastForward: (seconds: number) => void; placeComplete: (kind: string) => number | null };
    });
    const step = () => document.getElementById('tutorial')?.dataset.step ?? '';
    const villager = [...game.game.world.units.values()].find((u) => u.kind === 'villager' && u.owner === 1);
    const tree = [...game.game.world.nodes.values()].find((n) => n.kind === 'tree');
    if (!villager || !tree) return `missing-start:${step()}`;
    game.game.world.dispatch({ type: 'gather', unitIds: [villager.id], nodeId: tree.id });
    game.dev.fastForward(8);
    if (step() === 'gather') return 'stuck-gather';
    game.game.world.dispatch({ type: 'train', buildingId: game.game.world.townCenter.id });
    game.dev.fastForward(12);
    if (step() === 'train') return 'stuck-train';
    if (!game.dev.placeComplete('house')) return 'no-house';
    if (step() === 'house') return 'stuck-house';
    const scout = [...game.game.world.units.values()].find((u) => u.kind === 'scout' && u.owner === 1);
    if (!scout) return 'no-scout';
    game.game.world.dispatch({ type: 'move', unitIds: [scout.id], target: { x: scout.pos.x + 18, z: scout.pos.z + 6 } });
    game.dev.fastForward(2);
    if (step() === 'scout') return 'stuck-scout';
    if (!game.dev.placeComplete('barracks')) return 'no-barracks';
    if (step() !== 'raid' && step() !== 'done') return `stuck-barracks:${step()}`;
    game.dev.fastForward(45);
    return step();
  });
  expect(finished).toBe('done');
  expect(Date.now() - started).toBeLessThan(60_000);
  await expect(page.locator('#tutorial-objective')).toHaveText('The polis stands.');
  expect(errors).toEqual([]);
});