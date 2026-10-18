import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page): Promise<void> {
  await page.goto('/?e2e');
  await page.waitForFunction(() => (window as any).game?.renderer?.webgl?.info?.render?.frame > 2);
}

test('mobile groups hide empty slots, support holding to assign, and recall from a shortcut', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'touch navigation');
  await boot(page);
  await expect(page.locator('.groups-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.group-btn:visible')).toHaveCount(0);
  const id = await page.evaluate(() => {
    const g = (window as any).game;
    const villager = [...g.world.units.values()].find((u: any) => u.owner === g.world.localPlayer && u.kind === 'villager') as any;
    g.selection.set([villager.id]);
    return villager.id;
  });

  await page.locator('.groups-toggle').tap();
  await expect(page.locator('#selection-panel')).toBeHidden();
  await expect(page.locator('.group-btn:visible')).toHaveCount(9);
  await expect(page.locator('.groups-hint')).toContainText('Hold to assign');
  const first = page.locator('.group-btn[data-group="1"]');
  await first.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 10, button: 0 });
  await expect.poll(async () => page.evaluate(() => (window as any).game.controls.groups.get(1))).toEqual([id]);
  await first.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 10 });
  await first.dispatchEvent('click');
  // Releasing a hold keeps the chooser open, so another group can be assigned.
  await expect(page.locator('.groups-toggle')).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Close control groups', exact: true }).tap();
  await expect(page.locator('#selection-panel')).toBeVisible();
  await expect(page.locator('.group-btn:visible')).toHaveCount(1);
  await page.evaluate(() => (window as any).game.selection.clear());
  await first.tap();
  await expect.poll(async () => page.evaluate(() => [...(window as any).game.selection.ids])).toEqual([id]);

  await page.locator('.groups-toggle').tap();
  // Nine groups remain assignable on a short landscape phone, with a visible close control.
  await page.setViewportSize({ width: 852, height: 393 });
  const last = page.locator('.group-btn[data-group="9"]');
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Close control groups', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: 'Close control groups', exact: true }).tap();

  // A short landscape action sheet shares space with group shortcuts. Groups remains
  // available and opens the chooser without losing the units being assigned.
  await page.locator('[data-menu="build"]').tap();
  await expect(first).toBeHidden();
  await page.locator('.groups-toggle').tap();
  await expect(page.locator('#build-grid')).toBeHidden();
  await expect(first).toBeVisible();
  await expect.poll(async () => page.evaluate(() => [...(window as any).game.selection.ids])).toEqual([id]);
  await page.getByRole('button', { name: 'Close control groups', exact: true }).tap();
});

test('mobile keeps Scout accessible while the map is folded and opens a working map', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'touch navigation');
  await boot(page);
  await expect(page.locator('.minimap')).toHaveClass(/collapsed/);
  await expect(page.locator('.minimap-frame')).toBeHidden();
  const scout = page.getByRole('button', { name: 'Find scout', exact: true });
  await expect(scout).toBeVisible();
  const bounds = await scout.boundingBox();
  expect(bounds!.width).toBeGreaterThanOrEqual(44);
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
  await scout.tap();
  await expect.poll(async () => page.evaluate(() => {
    const g = (window as any).game;
    return [...g.selection.ids].map((id) => g.world.units.get(id)?.kind);
  })).toEqual(['scout']);

  await page.getByRole('button', { name: 'Show map', exact: true }).tap();
  await expect(page.locator('#selection-panel')).toBeHidden();
  await expect(page.locator('.minimap-frame')).toBeVisible();
  const frame = await page.locator('.minimap-frame').boundingBox();
  await page.locator('.minimap-frame').tap({ position: { x: frame!.width / 2, y: frame!.height / 2 } });
  const target = await page.evaluate(() => {
    const g = (window as any).game;
    return { x: g.rig.rts.target.x / g.world.hf.width, z: g.rig.rts.target.z / g.world.hf.depth };
  });
  expect(target.x).toBeCloseTo(0.5, 1);
  expect(target.z).toBeCloseTo(0.5, 1);
  await page.getByRole('button', { name: 'Hide map', exact: true }).tap();
  await expect(page.locator('#selection-panel')).toBeVisible();
  await expect(scout).toBeVisible();
  await expect(page.locator('.minimap-frame')).toBeHidden();
});

test('desktop retains the open minimap and assigned group rail', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop navigation');
  await boot(page);
  await expect(page.locator('.minimap-frame')).toBeVisible();
  await expect(page.locator('.groups-toggle')).toBeHidden();
  await expect(page.locator('.group-btn:visible')).toHaveCount(0);
  await page.evaluate(() => {
    const g = (window as any).game;
    const unit = [...g.world.units.values()].find((u: any) => u.owner === g.world.localPlayer) as any;
    g.selection.set([unit.id]);
  });
  await page.keyboard.press('Control+1');
  await expect(page.locator('.group-btn:visible')).toHaveCount(1);
  await expect(page.locator('.group-btn[data-group="1"] .group-count')).toHaveText('1');
});
