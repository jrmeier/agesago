import { test, expect } from '@playwright/test';
import type { AddressInfo } from 'node:net';
import { createRelayServer } from '../src/network/relay';

test('two browsers join by code, gather/train in lockstep, reconnect, and complete a match', async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const remote = !['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL!).hostname);
  const relay = remote ? null : createRelayServer({ origins: [new URL(baseURL!).origin], turnMs: 25, reconnectMs: 3000 });
  if (relay) await new Promise<void>(resolve => relay.server.listen(0, '127.0.0.1', resolve));
  const port = relay ? (relay.server.address() as AddressInfo).port : null;
  const { viewport, isMobile, hasTouch, deviceScaleFactor, userAgent } = testInfo.project.use;
  const contexts = await Promise.all([browser.newContext({ viewport, isMobile, hasTouch, deviceScaleFactor, userAgent }), browser.newContext({ viewport, isMobile, hasTouch, deviceScaleFactor, userAgent })]);
  const [host, guest] = await Promise.all(contexts.map(context => context.newPage()));
  const errors: string[] = [];
  for (const page of [host, guest]) page.on('pageerror', e => errors.push(e.message));
  const url = `/?e2e&title=1&quality=low${port ? `&relay=${encodeURIComponent(`ws://127.0.0.1:${port}/multiplayer`)}` : ''}`;
  try {
    await Promise.all([host.goto(url), guest.goto(url)]);
    await host.getByRole('button', { name: 'Online game', exact: true }).click();
    await host.locator('#online-size').selectOption('small');
    await host.getByRole('button', { name: 'Create room', exact: true }).click();
    await expect(host.locator('#online-code')).toHaveValue(/^[A-Z0-9]{6}$/);
    const code = await host.locator('#online-code').inputValue();
    await guest.getByRole('button', { name: 'Online game', exact: true }).click();
    await guest.locator('#online-code').fill(code);
    await guest.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect(host.locator('#online-roster li')).toHaveCount(2);
    await host.getByRole('button', { name: 'Start match', exact: true }).click();
    for (const page of [host, guest]) await expect(page.locator('#online-status')).toContainText('Connected', { timeout: 60_000 });
    expect(await guest.evaluate(() => (window as any).game.world.localPlayer)).toBe(2);
    await host.evaluate(() => {
      const w = (window as any).game.world;
      w.dispatch({ type: 'train', buildingId: w.townCenter.id });
      const worker = [...w.units.values()].find((u: any) => u.kind === 'villager' && u.owner === 1) as any;
      const node = [...w.nodes.values()].find((n: any) => n.kind === 'tree' && w.visibility.isVisible(n.pos.x, n.pos.z)) as any;
      w.dispatch({ type: 'gather', unitIds: [worker.id], nodeId: node.id });
    });
    for (const page of [host, guest]) await expect.poll(() => page.evaluate(() => {
      const online = (window as any).game.online;
      if (online.status.includes('disagreed')) throw new Error(online.status);
      return online.checks.some((c: any) => c.turn >= 25);
    }), { timeout: 90_000 }).toBe(true);
    const checks = await Promise.all([host, guest].map(page => page.evaluate(() => (window as any).game.online.checks as { turn: number; hash: string }[])));
    const shared = checks[0].filter(a => checks[1].some(b => b.turn === a.turn));
    expect(shared.length).toBeGreaterThanOrEqual(2);
    for (const check of shared) expect(check.hash).toBe(checks[1].find(b => b.turn === check.turn)!.hash);
    // Interrupt the transport without altering either simulation, then use the reserved seat.
    await guest.evaluate(() => (window as any).game.online.socket.close());
    await expect(host.locator('#online-status')).toContainText('disconnected');
    await expect(guest.locator('#online-status')).toContainText('Connected', { timeout: 15_000 });
    await guest.evaluate(() => (window as any).game.world.dispatch({ type: 'resign' }));
    for (const page of [host, guest]) await expect.poll(() => page.evaluate(() => (window as any).game.world.gameOver?.winners), { timeout: 15_000 }).toEqual([1]);
    expect(errors).toEqual([]);
  } catch (error) {
    console.log('online peers', await Promise.all([host, guest].map(page => page.evaluate(() => {
      const game = (window as any).game;
      return game ? { turn: game.online.turn, status: game.online.status, checks: game.online.checks, time: game.world.time } : { booting: true };
    }).catch(() => ({ closed: true })))));
    throw error;
  } finally { for (const context of contexts) await context.close(); await relay?.close(); }
});

test('opt-in performance overlay reports frames and collapses without horizontal scroll', async ({ page }) => {
  await page.goto('/?e2e&debug=1&quality=low');
  await expect(page.locator('#perf-overlay pre')).toContainText('FPS', { timeout: 60_000 });
  await expect(page.locator('#perf-overlay pre')).toContainText('triangles');
  await page.locator('#perf-overlay summary').click();
  await expect(page.locator('#perf-overlay')).not.toHaveAttribute('open');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
