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

  let releaseMatch!: () => void;
  const matchReady = new Promise<void>(resolve => { releaseMatch = resolve; });
  await page.route(/\/assets\/(?:Game|sim|three)-[^/]+\.js$/, async route => {
    await matchReady;
    await route.continue();
  });
  try {
    await page.goto('/', { waitUntil: 'commit' });
    await expect(page.locator('#title-new')).toBeVisible();
    // The title must work even before the prefetched match module has finished loading.
    await page.waitForFunction(() => document.getElementById('title-screen')?.dataset.resume);
    await activate(page, '#title-new', phone);
    await expect(page.locator('#title-setup')).toBeVisible();
    await activate(page, '#title-setup-back', phone);
  } finally {
    releaseMatch();
  }
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
  await expect(page.locator('#title-audio-credit')).toContainText('synthesised');
  await expect(page.locator('#title-audio-credit')).toContainText('0 A.D. soundtrack');
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
  await expect(page.locator('#hud')).toBeVisible();
  expect(await page.evaluate(() => location.search)).toBe('?seed=42');

  await page.setViewportSize(phone ? { width: 412, height: 915 } : { width: 1280, height: 800 });
  if (phone) await activate(page, '#pause-match', true);
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

test('Online game paints with the menu and waits visibly for its lobby', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'phone';
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let releaseScripts!: () => void;
  let releaseLobby!: () => void;
  const scriptsReady = new Promise<void>(resolve => { releaseScripts = resolve; });
  const lobbyReady = new Promise<void>(resolve => { releaseLobby = resolve; });
  await page.route(/\/assets\/[^/]+\.js$/, async route => {
    await scriptsReady;
    if (/\/lobby-[^/]+\.js$/.test(route.request().url())) await lobbyReady;
    await route.continue();
  });
  try {
    await page.goto('/', { waitUntil: 'commit' });
    // No application script has run: the online action belongs to the initial HTML.
    await expect(page.locator('#title-online')).toBeVisible();
    // Web-font settling can move the whole centered card; compare the action's slot.
    const buttonSlot = () => page.locator('#title-online').evaluate(button => {
      const box = button.getBoundingClientRect();
      const row = button.parentElement!.getBoundingClientRect();
      return { width: box.width, height: box.height, x: box.x - row.x, y: box.y - row.y };
    });
    const initialSlot = await buttonSlot();
    releaseScripts();
    await page.waitForFunction(() => document.getElementById('title-screen')?.dataset.resume);
    expect(await buttonSlot()).toEqual(initialSlot);
    await activate(page, '#title-online', phone);
    await expect(page.locator('#title-online')).toHaveText('Loading…');
    await expect(page.locator('#title-online')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#title-online')).toBeDisabled();
    releaseLobby();
    await expect(page.locator('#online-lobby')).toBeVisible();
    await activate(page, '#online-back', phone);
    await expect(page.locator('#title-online')).toHaveText('Online game');
    await expect(page.locator('#title-online')).toHaveCount(1);
    await expect(page.locator('#title-online')).toBeEnabled();
    expect(await buttonSlot()).toEqual(initialSlot);
    expect(errors).toEqual([]);
  } finally {
    releaseScripts();
    releaseLobby();
  }
});

test('a failed lobby prefetch keeps the online action and retries after a visible error', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'phone';
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let requests = 0;
  await page.route(/\/assets\/lobby-[^/]+\.js$/, async route => {
    requests += 1;
    if (requests === 1) await route.abort('failed');
    else await route.continue();
  });
  await page.goto('/');
  await page.waitForFunction(() => document.getElementById('title-screen')?.dataset.resume);
  await expect.poll(() => requests).toBe(1);
  await expect(page.locator('#title-online')).toBeVisible();
  await activate(page, '#title-online', phone);
  await expect(page.locator('#title-online-note')).toHaveText('Online play could not load. Check your connection and try again.');
  await expect(page.locator('#title-online-note')).toBeVisible();
  await expect(page.locator('#title-online')).toBeEnabled();
  await activate(page, '#title-online', phone);
  await expect(page.locator('#online-lobby')).toBeVisible();
  expect(requests).toBeGreaterThanOrEqual(2);
  await expect(page.locator('#title-online-note')).toBeHidden();
  await expect(page.locator('#title-online-note')).toBeEmpty();
  expect(errors).toEqual([]);
});
