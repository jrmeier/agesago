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

test('resign opens the summary and draws every chart', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'phone';
  const errors = await boot(page);
  if (phone) await expect(page.locator('body')).toHaveClass(/touch/);

  const resign = page.locator('#resign-btn');
  await expect(resign).toBeVisible();
  if (phone) await resign.tap();
  else await resign.click();

  const sheet = page.locator('#endgame');
  await expect(sheet).toBeVisible();
  await expect(page.locator('#endgame-title')).toHaveText(/defeat/i);
  await expect(page.locator('#endgame-reason')).toHaveText(/resign/i);
  await expect(resign).toBeHidden();

  const drawn = await page.locator('.endgame-chart').evaluateAll((figs) =>
    figs.map((fig) => ({
      series: fig.getAttribute('data-series'),
      mark: fig.querySelector('circle, polyline') !== null,
    })),
  );
  expect(drawn.map((d) => d.series).sort()).toEqual(['explored', 'food', 'gold', 'population', 'stone', 'wood']);
  expect(drawn.every((d) => d.mark)).toBe(true);

  const text = (await sheet.innerText()).toLowerCase();
  expect(text).not.toContain('wonder');
  expect(text).not.toContain('relic');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  if (phone) await expect(page.locator('body')).toHaveClass(/touch/);
  expect(errors).toEqual([]);
});
