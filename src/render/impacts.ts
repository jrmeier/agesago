import * as THREE from 'three';
import type { Quality } from '../core/quality';

/** What a siege shot or blow kicks up: ground dust, or splinters and grit off a building. */
export type ImpactKind = 'dust' | 'debris';

/** Seconds an impact puff lasts. */
export const IMPACT_SECONDS = 0.8;

const PUFF_GEO = new THREE.IcosahedronGeometry(0.3, 0);
PUFF_GEO.userData.shared = 1;

const COLOR: Record<ImpactKind, number> = { dust: 0xc9b694, debris: 0x9a8f80 };

interface Puff {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  born: number;
  x: number;
  y: number;
  z: number;
  dx: number;
  dz: number;
  rise: number;
  size: number;
  kind: ImpactKind;
}

/**
 * Pooled impact puffs (M16-3): a ring of soft blobs that swell, rise and fade. Fixed pool by
 * quality tier; the oldest puff is reused when it is full. `update` does not allocate.
 */
export class ImpactPuffs {
  readonly object = new THREE.Group();
  private readonly puffs: Puff[] = [];
  private readonly perImpact: number;
  private readonly max: number;
  private now = 0;

  constructor(parent: THREE.Object3D, quality?: Pick<Quality, 'tier'>) {
    this.object.name = 'impacts';
    const tier = quality?.tier ?? 'medium';
    this.perImpact = tier === 'low' ? 2 : tier === 'medium' ? 4 : 6;
    this.max = tier === 'low' ? 12 : tier === 'medium' ? 32 : 48;
    parent.add(this.object);
  }

  /** Kick up a puff at (x, y, z); `size` ~1 for a bolt, ~2 for a boulder. */
  spawn(kind: ImpactKind, x: number, y: number, z: number, size: number): void {
    const count = Math.max(1, Math.round(this.perImpact * Math.min(1.5, size * 0.75)));
    const turn = (x * 0.37 + z * 0.61) % (Math.PI * 2);
    for (let i = 0; i < count; i++) {
      const puff = this.take();
      const a = turn + (i / count) * Math.PI * 2;
      puff.kind = kind;
      puff.born = this.now;
      puff.x = x;
      puff.y = y;
      puff.z = z;
      puff.dx = Math.cos(a) * size * 0.55;
      puff.dz = Math.sin(a) * size * 0.55;
      puff.rise = (kind === 'debris' ? 0.9 : 0.6) * size;
      puff.size = size;
      puff.mat.color.setHex(COLOR[kind]);
      puff.mesh.visible = true;
      this.place(puff, 0);
    }
  }

  /** Puffs alive right now (for tests and budgets). */
  get active(): number {
    let n = 0;
    for (const puff of this.puffs) if (puff.mesh.visible) n++;
    return n;
  }

  update(time: number): void {
    this.now = time;
    for (const puff of this.puffs) {
      if (!puff.mesh.visible) continue;
      const k = (time - puff.born) / IMPACT_SECONDS;
      if (k >= 1 || k < -0.01) {
        puff.mesh.visible = false;
        continue;
      }
      this.place(puff, Math.max(0, k));
    }
  }

  private place(puff: Puff, k: number): void {
    const out = 1 - (1 - k) * (1 - k);
    puff.mesh.position.set(puff.x + puff.dx * out, puff.y + 0.15 + puff.rise * out, puff.z + puff.dz * out);
    puff.mesh.scale.setScalar(puff.size * (0.5 + out * 1.1));
    puff.mat.opacity = (1 - k) * (puff.kind === 'debris' ? 0.65 : 0.5);
  }

  private take(): Puff {
    for (const puff of this.puffs) if (!puff.mesh.visible) return puff;
    if (this.puffs.length < this.max) return this.make();
    let oldest = this.puffs[0];
    for (const puff of this.puffs) if (puff.born < oldest.born) oldest = puff;
    return oldest;
  }

  private make(): Puff {
    const mat = new THREE.MeshBasicMaterial({ color: COLOR.dust, transparent: true, opacity: 0.5, depthWrite: false });
    const mesh = new THREE.Mesh(PUFF_GEO, mat);
    mesh.name = 'impact';
    mesh.visible = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.noShadow = 1;
    this.object.add(mesh);
    const puff: Puff = { mesh, mat, born: 0, x: 0, y: 0, z: 0, dx: 0, dz: 0, rise: 0, size: 1, kind: 'dust' };
    this.puffs.push(puff);
    return puff;
  }
}
