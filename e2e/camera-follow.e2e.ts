import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page) {
  await page.goto('/?e2e');
  await page.waitForFunction(() => (window as any).game?.renderer?.webgl?.info?.render?.frame > 2);
  return page.evaluate(() => {
    const g = (window as any).game;
    g.rig.rts.edgeScroll = false;
    g.ais.length = 0; // Isolate local camera input from unrelated AI dispatches.
    const villagers = [...g.world.units.values()].filter((u: any) => u.kind === 'villager' && u.owner === g.world.localPlayer) as any[];
    g.selection.set([villagers[1].id]);
    const dispatch = g.world.dispatch.bind(g.world);
    (window as any).__cameraOrders = [];
    g.world.dispatch = (cmd: any) => { (window as any).__cameraOrders.push(cmd); dispatch(cmd); };
    return { id: villagers[1].id, fallback: villagers[0].id, target: { ...g.rig.rts.target }, distance: g.rig.rts.distance };
  });
}
async function cycle(page: Page, phone: boolean) {
  if (phone) await page.locator('#touch-fps').tap();
  else await page.keyboard.press('f');
}
async function mode(page: Page, value: string) {
  await expect(page.locator('body')).toHaveAttribute('data-camera-mode', value);
}

test('follows a working villager, looks without orders, cycles and restores the overhead pose', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const fixture = await boot(page);
  const phone = info.project.name === 'phone';
  await page.evaluate(({ id }) => {
    const g = (window as any).game; const u = g.world.units.get(id);
    const node = [...g.world.nodes.values()].filter((n: any) => n.kind === 'tree').sort((a: any, b: any) => Math.hypot(a.pos.x-u.pos.x,a.pos.z-u.pos.z)-Math.hypot(b.pos.x-u.pos.x,b.pos.z-u.pos.z))[0] as any;
    g.world.dispatch({ type: 'gather', unitIds: [id], nodeId: node.id });
    (window as any).__cameraOrders.length = 0;
    (window as any).__workStart = { ...u.pos };
  }, fixture);
  await cycle(page, phone); await mode(page, 'pov');
  await expect(page.locator('.selection-panel')).toBeHidden();
  expect(await page.evaluate(({ id }) => {
    const g = (window as any).game;
    return { id: g.rig.followedId, hidden: !g.views.villagers.get(id).object.visible };
  }, fixture)).toEqual({ id: fixture.id, hidden: true });
  await expect.poll(() => page.evaluate(({ id }) => {
    const g = (window as any).game; const u = g.world.units.get(id); const before = (window as any).__workStart;
    return Math.hypot(u.pos.x - before.x, u.pos.z - before.z);
  }, fixture)).toBeGreaterThan(0.1);
  // Camera and avatar share the same interpolation on every rendered frame.
  const alignment = await page.evaluate(({ id }) => {
    const g = (window as any).game; const p = g.views.villagers.get(id).object.position; const c = g.rig.camera.position;
    return { dx: c.x - p.x, dz: c.z - p.z, eye: c.y - p.y };
  }, fixture);
  expect(alignment.dx).toBeCloseTo(0); expect(alignment.dz).toBeCloseTo(0); expect(alignment.eye).toBeCloseTo(0.852);
  const beforeLook = await page.evaluate(() => (window as any).game.rig.follow.yawOffset);
  if (phone) {
    // Real touch pointer routing on the LEFT half: this used to create a movement joystick.
    await page.evaluate(() => {
      const canvas = document.querySelector('#game-container canvas')!;
      canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', pointerId: 42, clientX: 80, clientY: 350, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', pointerId: 42, clientX: 140, clientY: 330, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', pointerId: 42, clientX: 140, clientY: 330, bubbles: true }));
    });
    await expect(page.locator('.touch-stick')).toBeHidden();
  } else {
    await page.mouse.move(600, 350); await page.mouse.down(); await page.mouse.move(690, 320, { steps: 5 }); await page.mouse.up();
    await page.keyboard.press('w'); await page.keyboard.press('s'); await page.keyboard.press('a');
  }
  await expect.poll(() => page.evaluate(() => (window as any).game.rig.follow.yawOffset)).not.toBe(beforeLook);
  await cycle(page, phone); await mode(page, 'third');
  expect(await page.evaluate(({ id }) => (window as any).game.views.villagers.get(id).object.visible, fixture)).toBe(true);
  if (!phone) { await page.mouse.move(600, 350); await page.mouse.down({ button: 'right' }); }
  await cycle(page, phone); await mode(page, 'rts');
  if (!phone) await page.mouse.up({ button: 'right' });
  const end = await page.evaluate(({ id }) => {
    const g = (window as any).game; const u = g.world.units.get(id);
    return { target: g.rig.rts.target, distance: g.rig.rts.distance, orders: (window as any).__cameraOrders,
      working: u.gatherType === 'wood', visible: g.views.villagers.get(id).object.visible };
  }, fixture);
  expect(end).toEqual({ target: fixture.target, distance: fixture.distance, orders: [], working: true, visible: true });
  expect(errors).toEqual([]);
});

test('selected own villager fallback, loss recovery, and no-villager feedback', async ({ page }, info) => {
  const fixture = await boot(page); const phone = info.project.name === 'phone';
  await page.evaluate(() => (window as any).game.selection.clear());
  await cycle(page, phone); await mode(page, 'pov');
  expect(await page.evaluate(() => (window as any).game.rig.followedId)).toBe(fixture.fallback);
  for (const loss of ['garrisoned', 'owner', 'removed']) {
    await page.evaluate(({ id, loss }) => {
      const g = (window as any).game; const u = g.world.units.get(id);
      if (loss === 'garrisoned') u.state = 'garrisoned';
      if (loss === 'owner') u.owner = 0;
      if (loss === 'removed') { g.world.units.delete(id); g.world.events.emit({ type: 'removed', id }); }
    }, { id: fixture.fallback, loss });
    await mode(page, 'rts');
    await expect(page.locator('#camera-status')).toContainText('unavailable');
    if (loss !== 'removed') {
      await page.evaluate(({ id }) => {
        const g = (window as any).game; const u = g.world.units.get(id); u.owner = g.world.localPlayer; u.state = 'idle';
      }, { id: fixture.fallback });
      await cycle(page, phone); await mode(page, 'pov');
    }
  }
  await page.evaluate(() => {
    const g = (window as any).game;
    for (const u of g.world.units.values()) if (u.kind === 'villager' && u.owner === g.world.localPlayer) u.state = 'garrisoned';
  });
  await cycle(page, phone); await mode(page, 'rts');
  await expect(page.locator('#camera-status')).toContainText('No available own villager');
});

test('visible camera button cycles all views with accessible names', async ({ page }, info) => {
  await boot(page);
  const button = page.locator(info.project.name === 'phone' ? '#touch-fps' : '#camera-cycle');
  await expect(button).toBeVisible();
  for (const [view, label] of [['pov', 'Villager POV'], ['third', 'Third-person'], ['rts', 'Overhead']]) {
    if (info.project.name === 'phone') await button.tap(); else await button.click();
    await mode(page, view);
    await expect(button).toContainText(label); await expect(button).toHaveAccessibleName(new RegExp(`Camera: ${label}`));
    if (view !== 'rts') await page.screenshot({ path: info.outputPath(`${view}.png`) });
  }
});
