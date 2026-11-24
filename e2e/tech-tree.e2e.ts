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

async function expectTreeContent(page: Page): Promise<void> {
  const body = page.locator('#tech-tree-body');
  await expect(body.locator('.tt-age-title').first()).toContainText('Village Age');
  await expect(body.locator('.tt-age-title')).toHaveCount(4);
  await expect(body.locator('[data-id="bronzeAxe"]')).toContainText('Bronze Axe');
  await expect(body.locator('[data-id="ironAxe"]')).toContainText('Requires');
  await expect(body.locator('[data-age="0"]')).toHaveAttribute('data-current', 'true');
}

test('the tech tree opens from its button and hotkey, pauses, and closes', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const phone = testInfo.project.name === 'phone';
  if (phone) await page.setViewportSize({ width: 360, height: 740 });
  const errors = await boot(page);
  if (phone) await expect(page.locator('body')).toHaveClass(/touch/);

  const tree = page.locator('#tech-tree');
  const btn = page.locator('#tech-tree-btn');
  await expect(tree).toBeHidden();

  // Phones keep match administration in the Menu sheet.
  if (phone) await activate(page, '#pause-match', true);
  await expect(btn).toBeVisible();
  const box = await btn.boundingBox();
  expect(box && box.width >= (phone ? 44 : 36) && box.height >= (phone ? 44 : 36)).toBe(true);

  await activate(page, '#tech-tree-btn', phone);
  await expect(tree).toBeVisible();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  await expectTreeContent(page);

  // Single player: the clock waits while the tree is open.
  const t0 = await simTime(page);
  await page.waitForTimeout(600);
  expect(await simTime(page)).toBe(t0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  if (phone) {
    const scroll = await page.locator('#tech-tree-body').evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(scroll).toBe(true);
    const tile = await page.locator('[data-id="bronzeAxe"]').boundingBox();
    expect(tile!.width).toBeGreaterThan(240);
    await expect(page.locator('#tech-tree-close')).toBeInViewport();
  }

  await activate(page, '#tech-tree-close', phone);
  await expect(tree).toBeHidden();
  await expect(btn).toHaveAttribute('aria-expanded', 'false');

  if (phone) {
    // Back to the Menu sheet, then resume play.
    await activate(page, '#pause-resume', true);
    await expect(page.locator('#pause-menu')).toBeHidden();
  }

  // Hotkey W opens it; Escape closes it without opening the pause menu.
  await page.locator('#game-container canvas').first().focus().catch(() => {});
  await page.keyboard.press('KeyW');
  await expect(tree).toBeVisible();
  await expectTreeContent(page);
  if (phone) await expect(page.locator('body')).toHaveClass(/touch/);
  await page.keyboard.press('Escape');
  await expect(tree).toBeHidden();
  await expect(page.locator('#pause-menu')).toBeHidden();

  // The clock runs again once it is closed.
  const t1 = await simTime(page);
  await expect.poll(() => simTime(page), { timeout: 10_000 }).toBeGreaterThan(t1);

  if (!phone) {
    await page.keyboard.press('KeyW');
    await expect(tree).toBeVisible();
    await page.keyboard.press('KeyW');
    await expect(tree).toBeHidden();
  }

  expect(errors).toEqual([]);
});

test('Roman Engineering tooltip and tree fit at 360 px', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const phone = testInfo.project.name === 'phone';
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/?e2e&title');
  await page.waitForFunction(() => document.getElementById('title-screen')?.dataset.resume != null);
  await activate(page, '#title-new', phone);
  await page.locator('#title-civ').selectOption('romans');
  await activate(page, '#title-start', phone);
  await page.waitForFunction(() => document.documentElement.dataset.civ === 'romans');
  if (phone) await activate(page, '#pause-match', true);
  await activate(page, '#tech-tree-btn', phone);
  const card = page.locator('#tech-tree-body [data-id="romanEngineering"]');
  await expect(card).toContainText('Roman Engineering');
  await card.scrollIntoViewIfNeeded();
  const fits = await card.evaluate(el => el.scrollWidth <= el.clientWidth + 1);
  expect(fits).toBe(true);
  await activate(page, '#tech-tree-close', phone);
  if (phone) await activate(page, '#pause-resume', true);
  await page.evaluate(() => {
    const w = window as any;
    w.game.paused = true;
    w.game.world.players.get(1).age = 1;
    w.dev.give({ food: 2000, wood: 2000, gold: 2000 });
    w.game.selection.set([w.dev.placeComplete('forge')]);
  });
  if (phone) await page.locator('#menu-tabs [data-menu="train"]').tap();
  const research = page.locator('#train-grid [data-research="romanEngineering"]');
  await expect(research).toHaveAttribute('title', /Buildings construct 30% faster; farmers gather 15% faster\./);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
