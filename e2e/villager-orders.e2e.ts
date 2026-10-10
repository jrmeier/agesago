import { expect, test } from '@playwright/test';

for (const target of ['tree', 'farm', 'foundation'] as const) {
  test(`orders a ${target} through an overlapping friendly villager`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/?e2e');
    await page.waitForFunction(() => (window as any).game?.renderer?.webgl?.info?.render?.frame > 2);

    const fixture = await page.evaluate((target) => {
      const g = (window as any).game;
      const w = g.world;
      (window as any).dev.give({ wood: 1000 });
      // Freeze autonomous movement while keeping real Controls, rendering, and dispatch active.
      w.tick = () => {};
      g.rig.rts.edgeScroll = false;
      const tc = w.townCenter.pos;
      let spot: { x: number; z: number } | null = null;
      for (let radius = 8; radius < 25 && !spot; radius++) {
        for (let i = 0; i < 16 && !spot; i++) {
          const angle = i * Math.PI / 8;
          const pos = { x: tc.x + Math.cos(angle) * radius, z: tc.z + Math.sin(angle) * radius };
          if (w.canPlace('farm', pos, 0).ok) spot = pos;
        }
      }
      if (!spot) throw new Error('No clear order fixture location');
      // Isolate this worker/target overlap from natural canopies and other units.
      for (const node of [...w.nodes.values()] as any[]) {
        w.nodes.delete(node.id);
        w.events.emit({ type: 'removed', id: node.id });
      }
      const workers = [...w.units.values()].filter((u: any) => u.kind === 'villager' && u.owner === w.localPlayer);
      const [selected, overlapping] = workers;
      for (const unit of [...w.units.values()] as any[]) {
        if (unit.id === selected.id || unit.id === overlapping.id) continue;
        w.units.delete(unit.id);
        w.events.emit({ type: 'removed', id: unit.id });
      }
      selected.pos = { x: spot.x + 4, z: spot.z };
      selected.prevPos = { ...selected.pos };
      overlapping.pos = { ...spot };
      overlapping.prevPos = { ...spot };
      w.dispatch({ type: 'stop', unitIds: workers.map((u: any) => u.id) });
      const id = 900_001;
      if (target === 'tree') {
        w.nodes.set(id, { id, kind: 'tree', type: 'wood', pos: { ...spot }, amount: 100, radius: 0.5 });
        w.events.emit({ type: 'spawned', id, kind: 'tree' });
      } else {
        const kind = target === 'farm' ? 'farm' : 'house';
        w.buildings.set(id, {
          id, kind, owner: w.localPlayer, pos: { ...spot }, radius: 2, rot: 0,
          hp: 100, maxHp: 100, complete: target === 'farm', buildProgress: target === 'farm' ? 1 : 0.1,
          food: 100, queue: 0, progress: 0,
        });
        w.events.emit({ type: 'spawned', id, kind });
      }
      w.visibility.state.fill(2);
      w.visibility.version++;
      g.selection.set([selected.id]);
      g.rig.focusOn(spot);
      const dispatch = w.dispatch.bind(w);
      (window as any).__villagerOrders = [];
      w.dispatch = (command: any) => {
        (window as any).__villagerOrders.push(command);
        dispatch(command);
      };
      return { selectedId: selected.id, overlapId: overlapping.id, targetId: id, spot };
    }, target);

    const aim = await page.evaluate((fixture) => {
      const g = (window as any).game;
      const camera = g.rig.camera;
      camera.updateMatrixWorld(true);
      const canvas = document.querySelector('#game-container canvas') as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const y = Math.max(0, g.world.hf.heightAt(fixture.spot.x, fixture.spot.z));
      const p = camera.position.clone().set(fixture.spot.x, y + 0.5, fixture.spot.z).project(camera);
      const cx = (p.x + 1) * canvas.clientWidth / 2;
      const cy = (1 - p.y) * canvas.clientHeight / 2;
      const behindIds: Record<string, number> = {};
      for (let dy = -24; dy <= 24; dy += 2) {
        for (let dx = -12; dx <= 12; dx += 2) {
          const x = rect.left + cx + dx;
          const y = rect.top + cy + dy;
          if (document.elementFromPoint(x, y) !== canvas) continue;
          const ndc = { x: (cx + dx) / canvas.clientWidth * 2 - 1, y: 1 - (cy + dy) / canvas.clientHeight * 2 };
          if (g.views.pick(ndc, camera) !== fixture.overlapId) continue;
          // Prove the same pixel covers the intended target when the friendly worker is removed.
          const worker = g.world.units.get(fixture.overlapId);
          g.world.units.delete(worker.id);
          const behind = g.views.pick(ndc, camera);
          g.world.units.set(worker.id, worker);
          if (behind === fixture.targetId) return { x, y };
          const type = g.world.units.has(behind) ? 'unit' : g.world.nodes.has(behind) ? 'node' : g.world.buildings.has(behind) ? 'building' : 'none';
          const key = `${type}:${behind}`;
          behindIds[key] = (behindIds[key] ?? 0) + 1;
        }
      }
      throw new Error(`No worker/target overlap: ${JSON.stringify({ cx, cy, behindIds, fixture })}`);
    }, fixture);
    expect(aim).toBeTruthy();
    if (testInfo.project.name === 'phone') await page.touchscreen.tap(aim!.x, aim!.y);
    else await page.mouse.click(aim!.x, aim!.y, { button: 'right' });

    await expect.poll(() => page.evaluate(() => (window as any).__villagerOrders)).toEqual([
      target === 'foundation'
        ? { type: 'construct', unitIds: [fixture.selectedId], buildingId: fixture.targetId }
        : { type: 'gather', unitIds: [fixture.selectedId], nodeId: fixture.targetId },
    ]);
    const assigned = await page.evaluate(({ selectedId, target }) => {
      const w = (window as any).game.world;
      const worker = w.units.get(selectedId);
      return { state: worker.state, targetId: target === 'foundation' ? w.buildState.get(selectedId) : worker.gatherNode };
    }, { selectedId: fixture.selectedId, target });
    expect(assigned).toEqual({ state: target === 'foundation' ? 'toBuild' : 'toNode', targetId: fixture.targetId });
    expect(await page.evaluate(() => [...(window as any).game.selection.ids])).toEqual([fixture.selectedId]);
    expect(errors).toEqual([]);
  });
}
