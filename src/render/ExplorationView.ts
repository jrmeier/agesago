import * as THREE from 'three';
import type { World } from '../sim/World';
import { block } from './props';
import { merge, modelMaterial, part } from './models';

/** Visible caches and relics sit on the same discoverable scenery the reward system uses. */
export class ExplorationView {
  readonly object = new THREE.Group();
  private readonly models = new Map<string, THREE.Mesh>();
  constructor(private readonly world: World) {
    this.object.name = 'exploration-rewards';
    for (const s of world.exploration.values()) {
      const pieces = s.kind === 'treasure'
        ? [block([0.65, 0.35, 0.42], 0x755034, [0, 0.18, 0]), block([0.7, 0.08, 0.45], 0xc8a74e, [0, 0.39, 0]),
          block([0.1, 0.37, 0.46], 0xc8a74e, [-0.21, 0.18, 0]), block([0.1, 0.37, 0.46], 0xc8a74e, [0.21, 0.18, 0])]
        : [part(new THREE.CylinderGeometry(0.2, 0.27, 0.12, 8), 0xc7b995, [0, 0.06, 0]),
          part(new THREE.OctahedronGeometry(0.24), 0xe8bd4f, [0, 0.4, 0]),
          part(new THREE.TorusGeometry(0.3, 0.025, 4, 12), 0xddc976, [0, 0.4, 0])];
      const mesh = new THREE.Mesh(merge(pieces), modelMaterial()); mesh.name = s.id; mesh.castShadow = true;
      this.models.set(s.id, mesh); this.object.add(mesh);
    }
  }
  sync(): void {
    for (const s of this.world.exploration.values()) {
      const mesh = this.models.get(s.id); if (!mesh) continue;
      const visible = s.carrier !== undefined ? this.world.visibility.isVisible(s.pos.x, s.pos.z) : this.world.visibility.isExplored(s.pos.x, s.pos.z);
      mesh.visible = visible && !(s.kind === 'treasure' && s.claimedBy !== undefined);
      const carried = s.carrier !== undefined;
      mesh.position.set(s.pos.x, Math.max(0, this.world.hf.heightAt(s.pos.x, s.pos.z)) + (carried ? 1.8 : 0), s.pos.z);
    }
  }
}
