import { readFile } from 'node:fs/promises';
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

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as any).game?.renderer?.webgl?.info?.render?.frame > 2, null, { timeout: 30_000 });
}

test('a save survives reload, a newer file does not replace it, and new match starts fresh', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const phone = testInfo.project.name === 'phone';
  const errors = await boot(page);
  if (phone) await expect(page.locator('body')).toHaveClass(/touch/);

  const save = page.locator('#save-copy');
  const open = page.locator('#open-file');
  const fresh = page.locator('#new-match');
  await expect(save).toBeVisible();
  await expect(open).toBeVisible();
  await expect(fresh).toBeVisible();

  for (const loc of [save, open, fresh]) {
    const box = await loc.boundingBox();
    expect(box && box.width >= (phone ? 44 : 36) && box.height >= (phone ? 44 : 36)).toBe(true);
  }
  const helpBox = await page.locator('#help-btn').boundingBox();
  const saveBox = await save.boundingBox();
  expect(helpBox && saveBox).toBeTruthy();
  if (phone) expect(saveBox!.y).toBeGreaterThan(helpBox!.y + helpBox!.height - 2);
  else expect(Math.abs(saveBox!.y - helpBox!.y)).toBeLessThan(8);

  const covered = await page.evaluate(() =>
    ['#save-copy', '#open-file', '#new-match', '#new-match-no'].filter((sel) => {
      const el = document.querySelector(sel);
      if (!el) return sel === '#new-match-no' ? '' : sel;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return '';
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit === el || el.contains(hit) ? '' : sel;
    }).filter(Boolean),
  );
  expect(covered).toEqual([]);

  const before = await page.evaluate(() => {
    const game = (window as any).game;
    const villager = [...game.world.units.values()].find((u: { kind: string; owner: number }) => u.kind === 'villager' && u.owner === 1);
    villager.path = [];
    villager.state = 'idle';
    villager.gatherNode = null;
    villager.pos = { x: villager.pos.x + 12, z: villager.pos.z + 4 };
    villager.prevPos = { x: villager.pos.x, z: villager.pos.z };
    game.world.stock.food = 123;
    game.rig.focusOn(villager.pos);
    game.rig.rts.distance = 18;
    game.rig.rts.settle();
    return {
      id: villager.id as number,
      x: villager.pos.x as number,
      z: villager.pos.z as number,
      cx: game.rig.rts.target.x as number,
      cz: game.rig.rts.target.z as number,
    };
  });

  const downloadPromise = page.waitForEvent('download');
  await activate(page, '#save-copy', phone);
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const file = JSON.parse(await readFile(downloadPath!)) as {
    view: { x: number; z: number; distance: number };
    sim: {
      units: { id: number; pos: { x: number; z: number } }[];
      players: { player: { id: number }; stock: { food: number } }[];
    };
  };
  const savedUnit = file.sim.units.find((unit) => unit.id === before.id);
  const savedFood = file.sim.players.find((player) => player.player.id === 1)?.stock.food;
  expect(savedUnit).toBeTruthy();
  expect(Math.abs(savedUnit!.pos.x - before.x)).toBeLessThanOrEqual(0.01);
  expect(Math.abs(savedUnit!.pos.z - before.z)).toBeLessThanOrEqual(0.01);
  expect(savedFood).toBe(123);
  expect(Math.abs(file.view.x - before.cx)).toBeLessThanOrEqual(0.05);
  expect(Math.abs(file.view.z - before.cz)).toBeLessThanOrEqual(0.05);
  expect(Math.abs(file.view.distance - 18)).toBeLessThanOrEqual(0.05);
  await expect(page.locator('#save-note')).toHaveText('Saved');

  await page.reload();
  await waitReady(page);
  const restored = await page.evaluate((id) => {
    const game = (window as any).game;
    const villager = game.world.units.get(id);
    return {
      x: villager.pos.x as number,
      z: villager.pos.z as number,
      food: game.world.stock.food as number,
      cx: game.rig.rts.target.x as number,
      cz: game.rig.rts.target.z as number,
      distance: game.rig.rts.distance as number,
      mode: game.rig.mode as string,
    };
  }, before.id);
  expect(Math.abs(restored.x - savedUnit!.pos.x)).toBeLessThanOrEqual(0.01);
  expect(Math.abs(restored.z - savedUnit!.pos.z)).toBeLessThanOrEqual(0.01);
  expect(restored.food).toBe(123);
  expect(Math.abs(restored.cx - file.view.x)).toBeLessThanOrEqual(0.05);
  expect(Math.abs(restored.cz - file.view.z)).toBeLessThanOrEqual(0.05);
  expect(Math.abs(restored.distance - file.view.distance)).toBeLessThanOrEqual(0.05);
  expect(restored.mode).toBe('rts');

  await page.locator('#open-file-input').setInputFiles({
    name: 'agesago-save.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      version: 1,
      sim: { version: 999 },
      view: { x: 0, z: 0, distance: 26 },
      groups: [],
      selection: [],
      charts: [],
      savedAt: 1,
    })),
  });
  await expect(page.locator('#save-note')).toHaveText(/Unsupported save version 999/);

  await page.reload();
  await waitReady(page);
  const kept = await page.evaluate((id) => {
    const game = (window as any).game;
    const villager = game.world.units.get(id);
    return { x: villager.pos.x as number, food: game.world.stock.food as number };
  }, before.id);
  expect(kept.food).toBe(123);
  expect(Math.abs(kept.x - savedUnit!.pos.x)).toBeLessThanOrEqual(0.01);

  await activate(page, '#new-match', phone);
  const ask = page.locator('#new-match-ask');
  await expect(ask).toBeVisible();
  await activate(page, '#new-match-no', phone);
  await expect(ask).toBeHidden();
  await activate(page, '#new-match', phone);
  const loaded = page.waitForEvent('load');
  await activate(page, '#new-match-yes', phone);
  await loaded;
  await waitReady(page);
  const again = await page.evaluate((id) => {
    const game = (window as any).game;
    const villager = game.world.units.get(id);
    return {
      x: villager?.pos.x as number | undefined,
      food: game.world.stock.food as number,
      time: game.world.time as number,
    };
  }, before.id);
  expect(again.food).toBe(0);
  expect(again.time).toBeLessThan(15);
  expect(again.x === undefined || Math.abs(again.x - before.x) > 5).toBe(true);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  if (phone) await expect(page.locator('body')).toHaveClass(/touch/);
  expect(errors).toEqual([]);
});

test('a finished resume reopens the summary with its chart, group, and selection', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const phone = testInfo.project.name === 'phone';
  const errors = await boot(page);
  if (phone) await expect(page.locator('body')).toHaveClass(/touch/);

  const villagerId = await page.evaluate(() => {
    const game = (window as any).game;
    const villager = [...game.world.units.values()].find((u: { kind: string; owner: number }) => u.kind === 'villager' && u.owner === 1);
    villager.path = [];
    villager.state = 'idle';
    villager.gatherNode = null;
    game.world.stock.food = 123;
    // The first sample is taken near time 0. Jump past the next interval so this stock is recorded.
    game.world.time = 30;
    game.selection.set([villager.id]);
    return villager.id as number;
  });

  await page.keyboard.down('Control');
  await page.keyboard.press('Digit1');
  await page.keyboard.up('Control');
  await page.waitForFunction(() => {
    const samples = (window as any).game.endgameLog?.samples as { food: number }[] | undefined;
    return !!samples?.some((sample) => sample.food === 123);
  });
  await page.evaluate(() => {
    (window as any).game.world.gameOver = { winners: [2], reason: 'resign' };
  });

  const downloadPromise = page.waitForEvent('download');
  await activate(page, '#save-copy', phone);
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const file = JSON.parse(await readFile(downloadPath!)) as {
    selection: number[];
    groups: [number, number[]][];
    charts: { food: number }[];
    sim: { systems: { gameOver: { reason: string } | null } };
  };
  expect(file.selection).toContain(villagerId);
  expect(file.groups.some(([n, ids]) => n === 1 && ids.includes(villagerId))).toBe(true);
  expect(file.charts.some((sample) => sample.food === 123)).toBe(true);
  expect(file.sim.systems.gameOver?.reason).toBe('resign');
  await expect(page.locator('#save-note')).toHaveText('Saved');

  await page.reload();
  // A finished match paints once and then stops the loop, so the frame counter stays low.
  await page.waitForFunction(
    () => (window as any).game?.world?.gameOver && (window as any).game?.renderer?.webgl?.info?.render?.frame > 0,
    null,
    { timeout: 30_000 },
  );
  await expect(page.locator('#endgame')).toBeVisible();
  await expect(page.locator('#endgame-title')).toHaveText(/defeat/i);
  await expect(page.locator('#endgame-reason')).toHaveText(/resign/i);
  const foodChart = page.locator('.endgame-chart[data-series="food"]');
  await expect(foodChart.locator('figcaption b')).toHaveText('123');
  await expect(foodChart.locator('circle, polyline')).toHaveCount(1);
  const restoredUi = await page.evaluate(() => {
    const game = (window as any).game;
    return {
      selection: [...game.selection.ids] as number[],
      group: game.controls.groups.get(1) as number[],
    };
  });
  expect(restoredUi.selection).toContain(villagerId);
  expect(restoredUi.group).toContain(villagerId);

  const loaded = page.waitForEvent('load');
  await activate(page, '#play-again', phone);
  await loaded;
  await waitReady(page);
  await expect(page.locator('#endgame')).toBeHidden();
  const fresh = await page.evaluate(() => ({
    food: (window as any).game.world.stock.food as number,
    over: (window as any).game.world.gameOver as unknown,
    time: (window as any).game.world.time as number,
  }));
  expect(fresh.food).toBe(0);
  expect(fresh.over).toBeNull();
  expect(fresh.time).toBeLessThan(15);
  expect(errors).toEqual([]);
});
