import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Input } from '../input/Input';
import type { Unit } from '../core/types';
import { testField } from '../input/testField';
import { CameraRig } from './CameraRig';
import { FollowCamera, villagerPose, VILLAGER_EYE_HEIGHT } from './FollowCamera';
import { surfaceAt } from '../input/pickGround';

function input(keys: string[] = []): Input {
  return { key: (key: string) => keys.includes(key), keyPressed: () => false, cancelPointer: vi.fn(), isDown: () => false,
    touch: { lookX: 0, lookY: 0, setMode: vi.fn(), gestures: [], active: false },
    wheel: 0, inside: false, drag: () => undefined,
  } as unknown as Input;
}
const target = { id: 7, x: 30, y: 1, z: 30, facing: 0 };

describe('villager follow camera', () => {
  it('uses the rendered interpolation and worker facing without changing the worker', () => {
    const unit = { id: 7, prevPos: { x: 20, z: 20 }, pos: { x: 24, z: 28 }, facing: 1.2 } as Unit;
    const before = JSON.stringify(unit);
    const pose = villagerPose(unit, testField(), 0.25);
    expect(pose).toMatchObject({ id: 7, x: 21, z: 22, facing: 1.2 });
    expect(pose.y).toBe(surfaceAt(testField(), 21, 22));
    expect(JSON.stringify(unit)).toBe(before);
  });
  it('puts POV at villager eyes, faces +z at zero and ignores movement keys', () => {
    const cam = new THREE.PerspectiveCamera();
    const follow = new FollowCamera(cam, testField());
    follow.pitch = 0;
    follow.update(1, input(['KeyW', 'KeyA', 'KeyS', 'KeyD']), target, 'pov');
    expect(cam.position.toArray()).toEqual([30, 1 + VILLAGER_EYE_HEIGHT, 30]);
    expect(cam.getWorldDirection(new THREE.Vector3()).z).toBeCloseTo(1);
    follow.update(1, input(), { ...target, x: 32, facing: Math.PI / 2 }, 'pov');
    expect(cam.position.x).toBe(32);
    expect(cam.getWorldDirection(new THREE.Vector3()).x).toBeCloseTo(1);
  });
  it('places third-person behind, clamps orbit pitch/distance, and clears terrain', () => {
    const hf = testField();
    const cam = new THREE.PerspectiveCamera();
    const follow = new FollowCamera(cam, hf);
    const pose = { ...target, y: surfaceAt(hf, target.x, target.z) };
    follow.update(0, input(), pose, 'third');
    expect(cam.position.z).toBeLessThan(pose.z);
    expect(cam.position.y).toBeGreaterThan(surfaceAt(hf, cam.position.x, cam.position.z) + 0.44);
    const look = input(['ArrowDown']); look.wheel = 100000;
    follow.update(10, look, pose, 'third');
    expect(follow.pitch).toBe(-1.1);
    expect(follow.distance).toBe(10);
  });
  it('chooses a clear shoulder angle when a building blocks the rear boom', () => {
    const cam = new THREE.PerspectiveCamera();
    const follow = new FollowCamera(cam, testField(true));
    follow.pitch = -0.35;
    follow.obstacleDistance = (from, to) => Math.abs(to.x - from.x) < 0.5 ? 0.7 : Infinity;
    follow.apply({ ...target, y: surfaceAt(testField(true), target.x, target.z) }, 'third');
    expect(Math.abs(cam.position.x - target.x)).toBeGreaterThan(1);
    expect(cam.position.distanceTo(new THREE.Vector3(target.x, surfaceAt(testField(true), 30, 30) + VILLAGER_EYE_HEIGHT, target.z))).toBeGreaterThan(3);
  });
  it('cycles three modes, keeps the same worker and restores overhead target/zoom', () => {
    const rig = new CameraRig(testField(), input(), { x: 30, z: 30 });
    rig.resolveTarget = vi.fn(() => target);
    const pose = rig.camera.position.clone();
    const at = { ...rig.rts.target }; const distance = rig.rts.distance;
    rig.cycleMode(); expect(rig.mode).toBe('pov'); expect(rig.followedId).toBe(7);
    rig.cycleMode(); expect(rig.mode).toBe('third');
    expect(rig.resolveTarget).toHaveBeenLastCalledWith(7, 1);
    rig.cycleMode(); expect(rig.mode).toBe('rts'); expect(rig.followedId).toBeNull();
    expect(rig.rts.target).toEqual(at); expect(rig.rts.distance).toBe(distance);
    expect(rig.camera.position.distanceTo(pose)).toBeLessThan(1e-9);
  });
  it('explains missing villagers and returns overhead if the followed worker is lost', () => {
    const rig = new CameraRig(testField(), input(), { x: 30, z: 30 });
    rig.feedback = vi.fn();
    rig.cycleMode(); expect(rig.mode).toBe('rts'); expect(rig.feedback).toHaveBeenCalledWith('No available own villager to follow.');
    rig.resolveTarget = () => target; rig.cycleMode();
    rig.resolveTarget = () => null; rig.update(0);
    expect(rig.mode).toBe('rts'); expect(rig.followedId).toBeNull();
    expect(rig.feedback).toHaveBeenLastCalledWith('Villager unavailable — returned to Overhead.');
  });
});
