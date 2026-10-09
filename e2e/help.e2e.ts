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

test('the hotkey panel lists the bound keys', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'phone';
  const errors = await boot(page);
  if (phone) await expect(page.locator('body')).toHaveClass(/touch/);

  const help = page.locator('#help-btn');
  await expect(help).toBeVisible();
  const box = await help.boundingBox();
  expect(box && box.width >= (phone ? 44 : 36) && box.height >= (phone ? 44 : 36)).toBe(true);

  await activate(page, '#help-btn', phone);
  const dialog = page.locator('#hotkey-help');
  await expect(dialog).toBeVisible();
  await expect(help).toHaveAttribute('aria-expanded', 'true');

  const text = await page.locator('#hotkey-list').innerText();
  expect(text).toContain('Build a House');
  expect(text).toContain('Town bell');
  expect(text).toContain('Attack-move');
  expect(text).toContain('Select group 1');
  expect(await page.locator('#hotkey-list li').count()).toBeGreaterThanOrEqual(36);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  if (phone) await expect(page.locator('body')).toHaveClass(/touch/);

  await activate(page, '#hotkey-close', phone);
  await expect(dialog).toBeHidden();
  await expect(help).toHaveAttribute('aria-expanded', 'false');

  if (!phone) {
    await page.keyboard.press('Shift+Slash');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }

  expect(errors).toEqual([]);
});
