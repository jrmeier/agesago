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
  const helpBox = await page.locator('#help-btn').boundingBox();
  const saveBox = await page.locator('#save-copy').boundingBox();
  expect(helpBox && saveBox && box).toBeTruthy();
  if (phone) expect(box!.y).toBeGreaterThan(helpBox!.y + helpBox!.height - 2);
  else expect(Math.abs(box!.y - helpBox!.y)).toBeLessThan(8);

  const covered = await page.evaluate(() =>
    ['#pause-match', '#save-copy', '#pause-resume', '#pause-menu [data-speed="2"]'].filter((sel) => {
      const el = document.querySelector(sel);
      if (!el) return sel;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return sel === '#pause-resume' || sel.startsWith('#pause-menu') ? '' : sel;
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
  const frozen = await simTime(page);
  await page.waitForTimeout(400);
  expect(await simTime(page)).toBe(frozen);

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
    await page.keyboard.press('Escape');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Shift+Slash');
    await expect(page.locator('#hotkey-help')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#hotkey-help')).toBeHidden();
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();

    await activate(page, '#new-match', false);
    await expect(page.locator('#new-match-ask')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#new-match-ask')).toBeHidden();
    await expect(menu).toBeHidden();

    await page.keyboard.press('KeyA');
    await page.keyboard.press('KeyQ');
    await expect(page.locator('body')).toHaveClass(/targeting/);
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).not.toHaveClass(/targeting/);
    await expect(menu).toBeHidden();

    await page.keyboard.press('KeyA');
    await page.keyboard.press('KeyH');
    await expect(page.locator('body')).toHaveClass(/placing/);
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).not.toHaveClass(/placing/);
    await expect(menu).toBeHidden();
  }

  expect(errors).toEqual([]);
});
