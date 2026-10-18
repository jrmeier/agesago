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

async function simTime(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).game.world.time as number);
}

const INPUT_TIMEOUT = 15_000;

/** Hotkeys run in the game frame; wait until it consumes each key before sending the next. */
async function pressGameKey(page: Page, key: string, code = key): Promise<void> {
  await page.keyboard.press(key);
  await expect.poll(
    () => page.evaluate((code) => (window as any).game.input.keyPressed(code) as boolean, code),
    { timeout: INPUT_TIMEOUT, message: `${code} should be consumed by a game frame` },
  ).toBe(false);
}

async function selectAllOwn(page: Page): Promise<void> {
  await pressGameKey(page, 'KeyA');
  const ownIds = await page.evaluate(() => {
    const g = (window as any).game;
    return ([...g.world.units.values()] as any[])
      .filter((unit) => unit.owner === g.world.localPlayer && unit.state !== 'garrisoned')
      .map((unit) => unit.id as number)
      .sort((a, b) => a - b);
  });
  expect(ownIds.length).toBeGreaterThan(0);
  await expect.poll(
    () => page.evaluate(() => ([...(window as any).game.selection.ids] as number[]).sort((a, b) => a - b)),
    { timeout: INPUT_TIMEOUT, message: 'A should select every own ungarrisoned unit before the next order hotkey' },
  ).toEqual(ownIds);
}

test('pause freezes the clock and the speed buttons set 0.5× through 2×', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const phone = testInfo.project.name === 'phone';
  const errors = await boot(page);
  if (phone) await expect(page.locator('body')).toHaveClass(/touch/);

  const pause = page.locator('#pause-match');
  const menu = page.locator('#pause-menu');
  await expect(pause).toBeVisible();
  await expect(menu).toBeHidden();

  const box = await pause.boundingBox();
  expect(box && box.width >= (phone ? 44 : 36) && box.height >= (phone ? 44 : 36)).toBe(true);
  if (phone) {
    await expect(pause).toHaveAccessibleName('Open game menu');
    const header = await page.locator('.hud-top').boundingBox();
    expect(header!.height).toBeLessThanOrEqual(56);
    for (const id of ['help-btn', 'save-copy', 'open-file', 'new-match', 'resign-btn']) {
      await expect(page.locator(`#${id}`)).toBeHidden();
    }
  } else {
    const helpBox = await page.locator('#help-btn').boundingBox();
    expect(helpBox && box).toBeTruthy();
    expect(Math.abs(box!.y - helpBox!.y)).toBeLessThan(8);
  }

  const covered = await page.evaluate(() =>
    ['#pause-match', '#save-copy', '#pause-resume', '#pause-menu [data-speed="2"]'].filter((sel) => {
      const el = document.querySelector(sel);
      if (!el) return sel;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return '';
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit === el || el.contains(hit) ? '' : sel;
    }).filter(Boolean),
  );
  expect(covered).toEqual([]);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await activate(page, '#pause-match', phone);
  await expect(menu).toBeVisible();
  await expect(pause).toHaveAttribute('aria-pressed', 'true');
  await expect(pause).toHaveAttribute('aria-expanded', 'true');
  if (phone) {
    for (const id of ['help-btn', 'save-copy', 'open-file', 'new-match', 'resign-btn']) {
      const action = page.locator(`#pause-match-actions #${id}`);
      await expect(action).toBeVisible();
      const target = await action.boundingBox();
      expect(target!.width).toBeGreaterThanOrEqual(44);
      expect(target!.height).toBeGreaterThanOrEqual(44);
    }
  }
  const frozen = await simTime(page);
  await page.waitForTimeout(400);
  expect(await simTime(page)).toBe(frozen);

  if (phone) {
    const chooser = page.waitForEvent('filechooser');
    await activate(page, '#open-file', true);
    await (await chooser).setFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
    await expect(page.locator('#save-note')).toHaveText('That file could not be opened.');
    await activate(page, '#help-btn', true);
    await expect(page.locator('#hotkey-help')).toBeVisible();
    await activate(page, '#hotkey-close', true);
    await expect(page.locator('#hotkey-help')).toBeHidden();
    await expect(menu).toBeVisible();
    await activate(page, '#new-match', true);
    await expect(page.locator('#new-match-ask')).toBeVisible();
    await activate(page, '#new-match-no', true);
    await expect(page.locator('#new-match-ask')).toBeHidden();
    await expect(menu).toBeVisible();
    expect(await simTime(page)).toBe(frozen);
  }

  for (const speed of ['0.5', '1', '1.5', '2']) {
    await activate(page, `#pause-menu [data-speed="${speed}"]`, phone);
    await expect(page.locator(`#pause-menu [data-speed="${speed}"]`)).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => (window as any).game.speed)).toBe(Number(speed));
  }
  expect(await simTime(page)).toBe(frozen);

  await activate(page, '#pause-resume', phone);
  await expect(menu).toBeHidden();
  await expect(pause).toHaveAttribute('aria-pressed', 'false');
  const resumed = await simTime(page);
  await page.waitForFunction((t0) => (window as any).game.world.time > t0, resumed, { timeout: 8_000 });

  if (!phone) {
    await pressGameKey(page, 'Escape');
    await expect(menu).toBeVisible({ timeout: INPUT_TIMEOUT });
    await pressGameKey(page, 'Shift+Slash', 'Slash');
    await expect(page.locator('#hotkey-help')).toBeVisible({ timeout: INPUT_TIMEOUT });
    await pressGameKey(page, 'Escape');
    await expect(page.locator('#hotkey-help')).toBeHidden({ timeout: INPUT_TIMEOUT });
    await expect(menu).toBeVisible();
    await pressGameKey(page, 'Escape');
    await expect(menu).toBeHidden({ timeout: INPUT_TIMEOUT });

    await activate(page, '#new-match', false);
    await expect(page.locator('#new-match-ask')).toBeVisible();
    await pressGameKey(page, 'Escape');
    await expect(page.locator('#new-match-ask')).toBeHidden({ timeout: INPUT_TIMEOUT });
    await expect(menu).toBeHidden();

    await selectAllOwn(page);
    await pressGameKey(page, 'KeyQ');
    await expect(page.locator('body')).toHaveClass(/targeting/, { timeout: INPUT_TIMEOUT });
    await pressGameKey(page, 'Escape');
    await expect(page.locator('body')).not.toHaveClass(/targeting/, { timeout: INPUT_TIMEOUT });
    await expect(menu).toBeHidden();

    await selectAllOwn(page);
    await pressGameKey(page, 'KeyH');
    await expect(page.locator('body')).toHaveClass(/placing/, { timeout: INPUT_TIMEOUT });
    await pressGameKey(page, 'Escape');
    await expect(page.locator('body')).not.toHaveClass(/placing/, { timeout: INPUT_TIMEOUT });
    await expect(menu).toBeHidden();
  }

  expect(errors).toEqual([]);
});
