import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Building, type BuildingKind, type Command } from '../core/types';
import { qualityTier } from '../core/quality';
import { Selection } from '../game/Selection';
import { EntityViews } from '../render/EntityViews';
import { FogOfWar } from '../render/fog';
import { defaultPlayers, World } from '../sim/World';
import { type CameraRig } from '../camera/CameraRig';
import { classifyRelease, Controls, rectBetween, resolveLongPress } from './Controls';
import { DRAG_THRESHOLD_PX, exceedsDragThreshold, LMB, RMB, type Input } from './Input';
import { type GestureEvent } from './gestures';
import { pickGround, pickGround3 } from './pickGround';
import { testField } from './testField';

describe('click vs drag', () => {
  it('uses a 5 px threshold', () => {
    expect(exceedsDragThreshold(0, 0, DRAG_THRESHOLD_PX, 0)).toBe(false);
    expect(exceedsDragThreshold(0, 0, 3, 4)).toBe(false);
    expect(exceedsDragThreshold(0, 0, 4, 4)).toBe(true);
  });

  it('classifies releases', () => {
    expect(classifyRelease(undefined)).toBeNull();
    expect(classifyRelease({ held: true, dragging: true })).toBeNull();
    expect(classifyRelease({ held: false, dragging: false })).toBe('click');
    expect(classifyRelease({ held: false, dragging: true })).toBe('drag');
  });

  it('normalises box corners', () => {
    expect(rectBetween(30, 5, 10, 20)).toEqual({ x0: 10, y0: 5, x1: 30, y1: 20 });
  });
});

describe('pickGround', () => {
  const down = (x: number, z: number) => new THREE.Ray(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0));

  it('hits flat ground straight below', () => {
    const p = pickGround(down(12, 30), testField(true))!;
    expect(p.x).toBeCloseTo(12);
    expect(p.z).toBeCloseTo(30);
  });

  it('finds the first surface crossing of an oblique ray over hills', () => {
    const hf = testField();
    const ray = new THREE.Ray(new THREE.Vector3(30, 25, 50), new THREE.Vector3(0.1, -0.8, -0.6).normalize());
    const p = pickGround3(ray, hf)!;
    expect(p).not.toBeNull();
    expect(Math.abs(p.y - Math.max(hf.heightAt(p.x, p.z), 0))).toBeLessThan(0.01);
    const t = p.distanceTo(ray.origin);
    const q = new THREE.Vector3();
    for (let s = 0; s < t - 0.05; s += 0.05) {
      ray.at(s, q);
      if (q.x >= 0 && q.z >= 0 && q.x <= 64 && q.z <= 48) expect(q.y).toBeGreaterThan(Math.max(hf.heightAt(q.x, q.z), 0) - 1e-6);
    }
  });

  it('treats water as a surface at sea level', () => {
    expect(pickGround3(down(10, 10), testField())!.y).toBeCloseTo(0);
  });

  it('returns null when the ray misses the map', () => {
    expect(pickGround(down(-5, 10), testField())).toBeNull();
    const up = new THREE.Ray(new THREE.Vector3(10, 50, 10), new THREE.Vector3(0, 1, 0));
    expect(pickGround(up, testField())).toBeNull();
  });
});

describe('touch long-press attack-move', () => {
  const ground = { x: 40, z: 12 };
  const selected = [
    { id: 4, kind: 'swordsman' as const },
    { id: 5, kind: 'archer' as const },
    { id: 8, kind: 'villager' as const },
    { id: 9, kind: 'scout' as const },
  ];

  it('attack-moves the selected soldiers and leaves villagers and scouts', () => {
    expect(resolveLongPress({ selected, ownUnitId: null, ground })).toEqual({
      type: 'attackMove',
      unitIds: [4, 5],
      target: ground,
    });
  });

  it('toggles an own unit under the finger instead of ordering', () => {
    expect(resolveLongPress({ selected, ownUnitId: 4, ground })).toEqual({ type: 'toggle', id: 4 });
    expect(resolveLongPress({ selected, ownUnitId: 8, ground })).toEqual({ type: 'toggle', id: 8 });
  });

  it('orders nothing with no soldiers, or when the press misses the map', () => {
    expect(resolveLongPress({ selected: [{ id: 8, kind: 'villager' }], ownUnitId: null, ground })).toBeNull();
    expect(resolveLongPress({ selected: [{ id: 9, kind: 'scout' }], ownUnitId: null, ground })).toBeNull();
    expect(resolveLongPress({ selected, ownUnitId: null, ground: null })).toBeNull();
    expect(resolveLongPress({ selected: [], ownUnitId: null, ground })).toBeNull();
  });
});

/** Minimal DOM surface used by Controls and the render models; picking itself is real. */
function installOrderDom(): HTMLElement {
  const ctx: object = new Proxy(function () {}, { apply: () => ctx, get: () => ctx });
  const element = () => ({
    style: {}, dataset: {}, classList: { toggle() {}, contains: () => false },
    append() {}, appendChild() {}, addEventListener() {}, setAttribute() {},
    querySelector: () => null, getContext: () => ctx,
  });
  vi.stubGlobal('document', { createElement: element, getElementById: () => null, querySelector: () => null, body: element() });
  return element() as unknown as HTMLElement;
}

function orderScene(target: 'tree' | BuildingKind) {
  const hud = installOrderDom();
  const hf = testField(true);
  const world = new World(hf, {
    townCenter: { x: 6, z: 6 }, villagers: [{ x: 24, z: 24 }, { x: 30, z: 24 }],
    scouts: [], nodes: target === 'tree' ? [{ kind: 'tree', pos: { x: 30, z: 24 }, amount: 100 }] : [], props: [],
  }, defaultPlayers(2));
  const [selected, overlapping] = [...world.units.values()];
  let targetId: number;
  if (target === 'tree') targetId = [...world.nodes.keys()][0];
  else {
    const b: Building = {
      id: 100, kind: target, owner: 1, pos: { ...overlapping.pos }, rot: 0, radius: 2,
      hp: 100, maxHp: 100, complete: target !== 'house', buildProgress: target === 'house' ? 0.1 : 1,
      food: 100, queue: 0, progress: 0,
    };
    world.buildings.set(b.id, b);
    targetId = b.id;
  }
  const views = new EntityViews(world, qualityTier('low'));
  views.setFog(new FogOfWar(world.visibility, qualityTier('low')));
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(30, 14, 42);
  camera.lookAt(30, 1, 24);
  camera.updateMatrixWorld();
  const ndc3 = new THREE.Vector3(30, 1.5, 24).project(camera);
  const ndc = new THREE.Vector2(ndc3.x, ndc3.y);
  const point = { x: (ndc.x + 1) * 400, y: (1 - ndc.y) * 400 };
  const selection = new Selection();
  selection.set([selected.id]);
  const gestures: GestureEvent[] = [];
  let button: number | null = null;
  const input = {
    width: 800, height: 800, ctrl: false, shift: false,
    keyMods: () => undefined, keyPressed: () => false,
    drag: (b: number) => b === button ? { ...point, held: false, dragging: false, withSpace: false } : undefined,
    released: (b: number) => b === button,
    touch: { gestures, setGrabber() {}, disarmBox() {}, boxArmed: false },
  } as unknown as Input;
  const rig = { mode: 'rts', camera, rts: { hf }, onModeChange() {} } as unknown as CameraRig;
  const controls = new Controls({ world, views, rig, input, selection, hud, canvas: hud });
  const commands: Command[] = [];
  vi.spyOn(world, 'dispatch').mockImplementation((cmd) => { commands.push(cmd); });
  return {
    world, views, camera, ndc, selected, overlapping, targetId, selection, commands,
    click(mode: 'desktop' | 'touch' | 'select') {
      if (mode === 'touch') gestures.push({ type: 'tap', ...point });
      else button = mode === 'desktop' ? RMB : LMB;
      controls.update(0);
    },
  };
}

describe('orders through overlapping friendly villagers', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  for (const mode of ['desktop', 'touch'] as const) {
    for (const target of ['tree', 'farm', 'house'] as const) {
      it(`${mode} orders the ${target} instead of moving or selecting the villager`, () => {
        const s = orderScene(target);
        // Establish the overlap with the actual projected entity picker.
        expect(s.views.pick(s.ndc, s.camera)).toBe(s.overlapping.id);
        s.click(mode);
        expect(s.commands).toEqual([target === 'house'
          ? { type: 'construct', unitIds: [s.selected.id], buildingId: s.targetId }
          : { type: 'gather', unitIds: [s.selected.id], nodeId: s.targetId }]);
        expect([...s.selection.ids]).toEqual([s.selected.id]);
      });
    }
  }

  it('left-click still selects the overlapping villager', () => {
    const s = orderScene('tree');
    s.click('select');
    expect([...s.selection.ids]).toEqual([s.overlapping.id]);
    expect(s.commands).toEqual([]);
  });

  it('a touch tap on a distinct friendly unit still selects it', () => {
    const s = orderScene('tree');
    s.world.nodes.clear();
    s.click('touch');
    expect([...s.selection.ids]).toEqual([s.overlapping.id]);
    expect(s.commands).toEqual([]);
  });

  it('a building rally still targets the overlapping friendly unit', () => {
    const s = orderScene('tree');
    const tc = s.world.townCenter!;
    s.selection.set([tc.id]);
    s.click('desktop');
    expect(s.commands).toEqual([{
      type: 'rally', buildingId: tc.id, targetId: s.overlapping.id, pos: s.overlapping.pos,
    }]);
  });

  it('a completed house does not steal a touch selection from its friendly unit', () => {
    const s = orderScene('house');
    s.world.buildings.get(s.targetId)!.complete = true;
    s.click('touch');
    expect([...s.selection.ids]).toEqual([s.overlapping.id]);
    expect(s.commands).toEqual([]);
  });

  for (const kind of ['villager', 'deer'] as const) {
    for (const mode of ['desktop', 'touch'] as const) {
      it(`${mode} attacks a visible ${kind} overlapping a resource`, () => {
        const s = orderScene('tree');
        s.overlapping.owner = kind === 'deer' ? 0 : 2;
        s.overlapping.kind = kind;
        s.click(mode);
        expect(s.commands).toEqual([{ type: 'attack', unitIds: [s.selected.id], targetId: s.overlapping.id }]);
      });
    }
  }

  it('does not gather an unexplored resource through a friendly unit', () => {
    const s = orderScene('tree');
    s.world.visibility.state.fill(0);
    s.world.visibility.version++;
    s.click('desktop');
    expect(s.commands[0]?.type).toBe('move');
  });

  it('does not attack a fogged enemy through an explored resource', () => {
    const s = orderScene('tree');
    s.overlapping.owner = 2;
    s.world.visibility.state.fill(1);
    s.world.visibility.version++;
    s.click('desktop');
    expect(s.commands).toEqual([{ type: 'gather', unitIds: [s.selected.id], nodeId: s.targetId }]);
  });
});
