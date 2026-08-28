import * as THREE from 'three';

export type ResourceType = 'wood' | 'food' | 'gold';

/** A harvestable resource on the map (tree = wood, berries = food, gold ore = gold). */
export class ResourceNode {
  readonly pos: THREE.Vector2;
  amount: number;

  constructor(
    readonly type: ResourceType,
    x: number,
    z: number,
    amount: number,
    readonly obj: THREE.Object3D
  ) {
    this.pos = new THREE.Vector2(x, z);
    this.amount = amount;
  }

  get alive(): boolean {
    return this.amount > 0;
  }

  take(n: number): number {
    const got = Math.min(n, this.amount);
    this.amount -= got;
    return got;
  }
}
