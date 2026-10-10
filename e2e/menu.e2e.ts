import { expect, test, type Page } from '@playwright/test';

/** A mouse click on the phone project clears `body.touch`. Use a tap there. */
async function activate(page: Page, selector: string, phone: boolean): Promise<void> {
  const loc = page.locator(selector);
  if (phone) await loc.tap();
  else await loc.click();
}

test('the title screen starts a seeded match and continue reopens it', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const phone = testInfo.project.name === 'phone';
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('/');
  await expect(page.locator('#title-home')).toBeVisible();
  await expect(page.locator('#loading')).toBeHidden();
  if (!phone) {
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(wide).toBeLessThanOrEqual(1);
  }

  await page.setViewportSize({ width: 360, height: 640 });
  await page.waitForFunction(() => document.getElementById('title-screen')?.dataset.resume === 'no');
  const narrow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(narrow).toBeLessThanOrEqual(1);
  const newBox = await page.locator('#title-new').boundingBox();
  expect(newBox && newBox.width >= 44 && newBox.height >= 44).toBe(true);
  await expect(page.locator('#title-continue')).toBeDisabled();

  await activate(page, '#title-credits', phone);
  await expect(page.locator('#title-credits-panel')).toBeVisible();
  if (!phone) await page.keyboard.press('Escape');
  else await activate(page, '#title-credits-back', phone);
  await expect(page.locator('#title-home')).toBeVisible();

  await activate(page, '#title-new', phone);
  await expect(page.locator('#title-setup')).toBeVisible();
  if (!phone) {
    await page.keyboard.press('Escape');
    await expect(page.locator('#title-home')).toBeVisible();
    await activate(page, '#title-new', phone);
  }

  await page.locator('#title-seed').fill('0');
  await activate(page, '#title-start', phone);
  await expect(page.locator('#title-seed-note')).toBeVisible();
  await expect(page.locator('#title-setup')).toBeVisible();

  await page.locator('#title-seed').fill('42');
  await activate(page, '#title-setup [data-players="3"]', phone);
  await expect(page.locator('#title-setup [data-players="3"]')).toHaveAttribute('aria-pressed', 'true');
  await activate(page, '#title-start', phone);

  await page.waitForFunction(
    () => document.documentElement.dataset.seed === '42' && document.documentElement.dataset.players === '3',
    null,
    { timeout: 30_000 },
  );
  await expect(page.locator('#title-screen')).toBeHidden();
  expect(await page.evaluate(() => location.search)).toBe('?seed=42');

  await page.setViewportSize(phone ? { width: 412, height: 915 } : { width: 1280, height: 800 });
  await activate(page, '#save-copy', phone);
  await expect(page.locator('#save-note')).toHaveText('Saved');
  await page.goto('/');
  await page.waitForFunction(() => document.getElementById('title-screen')?.dataset.resume === 'yes');
  await expect(page.locator('#title-continue')).toBeEnabled();
  await activate(page, '#title-new', phone);
  await expect(page.locator('#title-discard')).toBeVisible();
  if (!phone) await page.keyboard.press('Escape');
  else await activate(page, '#title-discard-no', phone);
  await expect(page.locator('#title-home')).toBeVisible();

  await activate(page, '#title-continue', phone);
  await page.waitForFunction(
    () => document.documentElement.dataset.seed === '42' && document.documentElement.dataset.players === '3',
    null,
    { timeout: 30_000 },
  );
  expect(errors).toEqual([]);
});
