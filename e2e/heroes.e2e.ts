import { expect, test, type Page } from '@playwright/test';

/** M16-6: train the civ's hero at a fortress, then the side-rail hero button selects it; death starts the cooldown. */

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

test('train a hero, use the hero button, and see the cooldown after it falls', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'phone';
  /** A mouse click on the phone project clears `body.touch`; tap there. */
  const press = (loc: ReturnType<Page['locator']>) => (phone ? loc.tap() : loc.click());
  const errors = await boot(page);
  const heroBtn = page.locator('#hero-btn');
  await expect(heroBtn).toBeHidden();

  const fort = await page.evaluate(() => {
    const w = window as any;
    w.dev.give({ food: 5000, wood: 5000, gold: 5000, stone: 5000 });
    w.dev.setAge(3);
    const id = w.dev.placeComplete('fortress');
    w.game.selection.set([id]);
    return id;
  });
  expect(fort).not.toBeNull();

  if (phone) await page.locator('#menu-tabs [data-menu="train"]').tap();
  const heroTile = page.locator('#train-grid [data-train]').nth(2);
  await expect(heroTile).toHaveAttribute('data-locked', 'false');
  const hero = await heroTile.getAttribute('data-train');
  expect(['leonidas', 'scipio', 'cyrus', 'vercingetorix']).toContain(hero);
  await press(heroTile);
  // The queued hero locks the tile: only one at a time.
  await expect(heroTile).toHaveAttribute('data-locked', 'true');
  await expect(heroTile.locator('.build-lock')).toHaveText('Your hero is already in the field');

  await page.evaluate(() => (window as any).dev.fastForward(45));
  await expect(heroBtn).toBeVisible();
  await expect(heroBtn.locator('use')).toHaveAttribute('href', `#i-${hero}`);

  // Clicking the portrait selects the hero (and centres the camera on it).
  await page.evaluate(() => (window as any).game.selection.set([]));
  await press(heroBtn);
  const selected = await page.evaluate(() => {
    const g = (window as any).game;
    return [...g.selection.ids].map((id: number) => g.world.units.get(id)?.kind);
  });
  expect(selected).toEqual([hero]);
  await expect(page.locator('#unit-auras')).toBeVisible();

  if (!phone) {
    // The ; hotkey does the same after the selection is cleared.
    await page.evaluate(() => (window as any).game.selection.set([]));
    await page.keyboard.press(';');
    await expect.poll(() => page.evaluate(() => (window as any).game.selection.ids.size)).toBe(1);
  }

  // Death: an alert toast, and the button turns into the retrain clock.
  const killed = await page.evaluate(() => {
    const w = window as any;
    return w.dev.kill([...w.game.selection.ids][0]);
  });
  expect(killed).toBe(true);
  await expect(page.locator('.toast-alert', { hasText: 'has fallen' })).toBeVisible();
  // The side rail repaints on the next rendered frame; under parallel workers SwiftShader frames on
  // this Empire Age scene can come seconds apart, so allow more than the default 5 s.
  await expect(heroBtn).toHaveClass(/cooldown/, { timeout: 15_000 });
  await expect(heroBtn.locator('.hero-clock')).toHaveText(/^[12]:\d\d$/, { timeout: 15_000 });
  expect(errors).toEqual([]);
});
