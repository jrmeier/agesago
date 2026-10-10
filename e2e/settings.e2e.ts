import { expect, test, type Page } from '@playwright/test';

/** A mouse click on the phone project clears `body.touch`. Use a tap there. */
async function activate(page: Page, selector: string, phone: boolean): Promise<void> {
  const loc = page.locator(selector);
  if (phone) await loc.tap();
  else await loc.click();
}

async function setRange(page: Page, selector: string, value: string): Promise<void> {
  await page.locator(selector).evaluate((el, next) => {
    const input = el as HTMLInputElement;
    input.value = next;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

test('settings persist, scale the UI, and apply in a match', async ({ page }, testInfo) => {
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
  const openBox = await page.locator('#title-settings').boundingBox();
  expect(openBox && openBox.width >= 44 && openBox.height >= 44).toBe(true);

  await activate(page, '#title-settings', phone);
  await expect(page.locator('#settings')).toBeVisible();
  const closeBox = await page.locator('#settings-close').boundingBox();
  expect(closeBox && closeBox.width >= 44 && closeBox.height >= 44).toBe(true);
  const qualityBox = await page.locator('#settings-quality').boundingBox();
  expect(qualityBox && qualityBox.height >= 44).toBe(true);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await setRange(page, '#settings-ui', '1.15');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim())).toBe('1.15');
  await activate(page, '#settings-edge', phone);
  await setRange(page, '#settings-master', '0.4');
  await activate(page, '#settings-colorblind', phone);
  await activate(page, '#settings-motion', phone);
  await expect(page.locator('html')).toHaveClass(/reduce-motion/);
  const scaledOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(scaledOverflow).toBeLessThanOrEqual(1);

  await activate(page, '#settings-close', phone);
  await expect(page.locator('#settings')).toBeHidden();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('agesago-settings') || '{}'));
  expect(saved.uiScale).toBe(1.15);
  expect(saved.edgeScroll).toBe(false);
  expect(saved.master).toBe(0.4);
  expect(saved.colorblind).toBe(true);
  expect(saved.reducedMotion).toBe(true);

  await page.reload();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim())).toBe('1.15');
  await expect(page.locator('html')).toHaveClass(/reduce-motion/);
  await activate(page, '#title-settings', phone);
  await expect(page.locator('#settings-edge')).not.toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings')).toBeHidden();
  await expect(page.locator('#title-home')).toBeVisible();

  await page.goto('/?e2e');
  await page.waitForFunction(() => {
    const frame = (window as unknown as { game?: { renderer?: { webgl?: { info?: { render?: { frame?: number } } } } } }).game?.renderer?.webgl?.info?.render?.frame ?? 0;
    return frame > 2;
  }, null, { timeout: 30_000 });
  const applied = await page.evaluate(() => {
    const game = (window as unknown as { game: { rig: { rts: { edgeScroll: boolean; invertPan: boolean } }; world: { players: Map<number, { player: { color: number } }> }; quality: { shadows: boolean } } }).game;
    const rival = [...game.world.players.values()][1]?.player.color;
    return { edge: game.rig.rts.edgeScroll, invert: game.rig.rts.invertPan, rival, shadows: game.quality.shadows };
  });
  expect(applied.edge).toBe(false);
  expect(applied.invert).toBe(false);
  expect(applied.rival).toBe(0xe69f00);

  await page.setViewportSize(phone ? { width: 412, height: 915 } : { width: 1280, height: 800 });
  await activate(page, '#pause-match', phone);
  await expect(page.locator('#pause-menu')).toBeVisible();
  const frozen = await page.evaluate(() => (window as unknown as { game: { world: { time: number } } }).game.world.time);
  await activate(page, '#pause-settings', phone);
  await expect(page.locator('#settings')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings')).toBeHidden();
  await expect(page.locator('#pause-menu')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { game: { world: { time: number } } }).game.world.time)).toBe(frozen);

  await activate(page, '#pause-settings', phone);
  await page.locator('#settings-quality').selectOption(phone ? 'high' : 'low');
  await expect(page.locator('#settings-note')).toContainText('next match');
  if (!phone) {
    const visible = await page.evaluate(() => {
      const grass = (window as unknown as { game: { renderer: { scene: { getObjectByName: (name: string) => { visible: boolean } | undefined } } } }).game.renderer.scene.getObjectByName('grass');
      return grass?.visible ?? null;
    });
    expect(visible).toBe(false);
  }
  await activate(page, '#settings-shadows', phone);
  const shadows = await page.evaluate(() => {
    const game = (window as unknown as { game: { quality: { shadows: boolean }; renderer: { webgl: { shadowMap: { enabled: boolean } } } } }).game;
    return { on: game.quality.shadows, map: game.renderer.webgl.shadowMap.enabled };
  });
  expect(shadows.on).toBe(!phone);
  expect(shadows.map).toBe(!phone);

  expect(errors).toEqual([]);
});
