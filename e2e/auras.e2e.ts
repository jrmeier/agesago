import { expect, test } from '@playwright/test';

test('a villager by the Town Center lists its active aura in the selection panel', async ({ page }) => {
  await page.goto('/?e2e&quality=low');
  await page.waitForFunction(() => (window as any).game?.renderer?.webgl?.info?.render?.frame > 2);
  await page.locator('#loading').waitFor({ state: 'detached' });
  // Starting villagers stand beside their Town Center; give the staggered aura scan a moment.
  await page.waitForFunction(() => {
    const g = (window as any).game;
    return [...g.world.auraActive.keys()].some((id: number) => g.world.units.get(id)?.owner === g.world.localPlayer);
  });
  await page.evaluate(() => {
    const g = (window as any).game;
    const id = [...g.world.auraActive.keys()].find((i: number) => g.world.units.get(i)?.owner === g.world.localPlayer);
    g.selection.set([id]);
  });
  const chip = page.locator('#unit-auras .aura-chip[data-aura="townCenterWork"]');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('Town Center Bustle');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);

  await page.evaluate(() => {
    const g = (window as any).game;
    g.selection.set([g.world.townCenter.id]);
  });
  await expect(page.locator('#unit-auras')).toBeHidden();
});
