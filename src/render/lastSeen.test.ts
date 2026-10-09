import { describe, expect, it } from 'vitest';
import { footprintRadius } from '../core/buildings';
import type { BuildingKind } from '../core/types';
import {
  buildingMayTarget,
  buildingPresentation,
  minimapBuildingBlips,
  rememberBuilding,
  shownSelection,
  sightFromState,
  stepLastSeen,
  unitMayShow,
  type LastSeenBuilding,
} from './lastSeen';

function seen(over: Partial<LastSeenBuilding> = {}): LastSeenBuilding {
  const pos = over.pos ?? { x: 12, z: 8 };
  return {
    id: over.id ?? 7,
    kind: over.kind ?? 'barracks',
    owner: over.owner ?? 2,
    pos: { x: pos.x, z: pos.z },
    rot: over.rot ?? 0,
    hp: over.hp ?? 400,
    maxHp: over.maxHp ?? 500,
    complete: over.complete ?? true,
  };
}

describe('who may be shown or targeted', () => {
  it('draws and targets enemy units only while the cell is visible', () => {
    expect(sightFromState(2)).toBe('visible');
    expect(sightFromState(1)).toBe('explored');
    expect(sightFromState(0)).toBe('unexplored');
    expect(sightFromState(9)).toBe('unexplored');

    for (const sight of ['unexplored', 'explored', 'visible'] as const) {
      expect(unitMayShow(true, sight)).toBe(true);
    }
    expect(unitMayShow(false, 'visible')).toBe(true);
    expect(unitMayShow(false, 'explored')).toBe(false);
    expect(unitMayShow(false, 'unexplored')).toBe(false);
  });

  it('shows a live enemy building only while visible, and will not target a snapshot', () => {
    const snap = seen();
    expect(buildingPresentation({ ownerIsLocal: false, sight: 'visible', fogActive: true, snap })).toBe('live');
    expect(buildingPresentation({ ownerIsLocal: false, sight: 'explored', fogActive: true, snap })).toBe('snapshot');
    expect(buildingPresentation({ ownerIsLocal: false, sight: 'explored', fogActive: true, snap: undefined })).toBe('hidden');
    expect(buildingPresentation({ ownerIsLocal: false, sight: 'unexplored', fogActive: true, snap })).toBe('hidden');

    expect(buildingMayTarget(false, 'visible', true)).toBe(true);
    expect(buildingMayTarget(false, 'explored', true)).toBe(false);
    expect(buildingMayTarget(false, 'unexplored', false)).toBe(false);

    expect(buildingPresentation({ ownerIsLocal: true, sight: 'unexplored', fogActive: false, snap: undefined })).toBe('live');
    expect(buildingPresentation({ ownerIsLocal: true, sight: 'unexplored', fogActive: true, snap: undefined })).toBe('hidden');
    expect(buildingPresentation({ ownerIsLocal: true, sight: 'explored', fogActive: true, snap: undefined })).toBe('live');
    expect(buildingMayTarget(true, 'explored', true)).toBe(true);
    expect(buildingMayTarget(true, 'unexplored', true)).toBe(false);
  });
});

describe('last-seen building snapshots', () => {
  const local = 1;
  const sightOf =
    (cells: Record<string, 'unexplored' | 'explored' | 'visible'>) => (x: number, z: number) =>
      cells[`${Math.floor(x)},${Math.floor(z)}`] ?? 'unexplored';

  it('remembers only the allowed fields, and does not alias the live position', () => {
    const pos = { x: 12, z: 8 };
    const live = {
      ...seen(),
      pos,
      buildProgress: 0.35,
      queue: 4,
      garrison: 3,
      food: 20,
    };
    const snap = rememberBuilding(live);
    pos.x = 99;
    expect(snap.pos).toEqual({ x: 12, z: 8 });
    expect(Object.keys(snap).sort()).toEqual(['complete', 'hp', 'id', 'kind', 'maxHp', 'owner', 'pos', 'rot']);
    expect('buildProgress' in snap).toBe(false);
    expect('garrison' in snap).toBe(false);
    expect('queue' in snap).toBe(false);
  });

  it('freezes hp, completion and pose in fog, and keeps a building that died unseen', () => {
    const live = seen();
    const first = stepLastSeen(new Map(), [live], local, sightOf({ '12,8': 'visible' }));
    expect(first.snaps.get(7)).toMatchObject({ hp: 400, complete: true, rot: 0, pos: { x: 12, z: 8 } });
    expect(first.confirmedGone).toEqual([]);

    live.hp = 15;
    live.complete = false;
    live.rot = Math.PI / 2;
    live.pos = { x: 12.4, z: 8.2 };
    const fogged = stepLastSeen(first.snaps, [live], local, sightOf({ '12,8': 'explored' }));
    expect(fogged.snaps.get(7)).toMatchObject({ hp: 400, complete: true, rot: 0, pos: { x: 12, z: 8 } });
    expect(fogged.snaps.get(7)).not.toBe(live);

    const dead = stepLastSeen(fogged.snaps, [], local, sightOf({ '12,8': 'explored' }));
    expect(dead.snaps.has(7)).toBe(true);
    expect(dead.confirmedGone).toEqual([]);

    const seenAgain = stepLastSeen(dead.snaps, [], local, sightOf({ '12,8': 'visible' }));
    expect(seenAgain.snaps.has(7)).toBe(false);
    expect(seenAgain.confirmedGone.map((b) => b.id)).toEqual([7]);
  });

  it('does not remember an enemy building that was never visible, or any own building', () => {
    const enemy = seen({ id: 3, pos: { x: 4, z: 4 } });
    const own = seen({ id: 1, owner: 1, pos: { x: 20, z: 20 } });
    const step = stepLastSeen(new Map(), [enemy, own], local, sightOf({ '4,4': 'explored', '20,20': 'visible' }));
    expect([...step.snaps.keys()]).toEqual([]);

    const seenOnce = stepLastSeen(new Map(), [enemy], local, sightOf({ '4,4': 'visible' }));
    const still = stepLastSeen(seenOnce.snaps, [own, enemy], local, sightOf({ '4,4': 'explored', '20,20': 'visible' }));
    expect([...still.snaps.keys()]).toEqual([3]);
    expect(still.snaps.has(1)).toBe(false);
  });

  it('draws minimap enemy buildings from the snapshot, including one that died in fog', () => {
    const ghost = seen({ id: 9, kind: 'house' as BuildingKind, pos: { x: 4, z: 5 }, hp: 10 });
    const snaps = stepLastSeen(new Map(), [ghost], local, sightOf({ '4,5': 'visible' })).snaps;
    ghost.pos = { x: 40, z: 40 };
    ghost.hp = 1;
    const fogged = stepLastSeen(snaps, [ghost], local, sightOf({ '4,5': 'explored' })).snaps;
    const dead = stepLastSeen(fogged, [], local, sightOf({ '4,5': 'explored' })).snaps;

    const blips = minimapBuildingBlips(
      local,
      [
        { id: 1, owner: 1, pos: { x: 10, z: 11 }, radius: 2.5 },
        { id: 8, owner: 2, pos: { x: 1, z: 1 }, radius: 3 },
      ],
      dead,
    );
    expect(blips.map((b) => b.id)).toEqual([9, 1]);
    expect(blips[0]).toMatchObject({ x: 4, z: 5, owner: 2, radius: footprintRadius('house') });
    expect(blips[1]).toMatchObject({ x: 10, z: 11, radius: 2.5 });
  });
});

describe('selection panel facts', () => {
  const sight = (x: number, _z: number) => (x === 12 ? 'explored' : x === 3 ? 'visible' : 'unexplored');

  it('omits hidden enemy units and describes a fogged building from the snapshot only', () => {
    const snap = seen({ hp: 80, maxHp: 500, complete: true });
    const snaps = new Map([[snap.id, snap]]);
    const hidden = shownSelection(
      [4, snap.id],
      1,
      (id) => (id === 4 ? { owner: 2, pos: { x: 12, z: 8 } } : undefined),
      (id) => (id === snap.id ? { owner: 2, pos: { x: 12, z: 8 } } : undefined),
      snaps,
      (x) => (x === 12 ? 'explored' : 'unexplored'),
    );
    expect(hidden.unitIds).toEqual([]);
    expect(hidden.liveBuildingId).toBeNull();
    expect(hidden.remembered).toMatchObject({ hp: 80, complete: true });
    expect(hidden.remembered).not.toHaveProperty('buildProgress');

    const visibleUnit = shownSelection(
      [4],
      1,
      () => ({ owner: 2, pos: { x: 3, z: 0 } }),
      () => undefined,
      snaps,
      sight,
    );
    expect(visibleUnit.unitIds).toEqual([4]);
    expect(visibleUnit.remembered).toBeNull();

    const own = shownSelection([5], 1, () => ({ owner: 1, pos: { x: 0, z: 0 } }), () => undefined, new Map(), () => 'unexplored');
    expect(own.unitIds).toEqual([5]);

    const liveBuilding = shownSelection(
      [snap.id],
      1,
      () => undefined,
      () => ({ owner: 2, pos: { x: 3, z: 0 } }),
      snaps,
      sight,
    );
    expect(liveBuilding.liveBuildingId).toBe(snap.id);
    expect(liveBuilding.remembered).toBeNull();
  });
});
