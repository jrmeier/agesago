import * as THREE from 'three';
import villagerUri from './sprites/villager';
import sheepUri from './sprites/sheep';
import treeUri from './sprites/tree';
import berriesUri from './sprites/berries';
import goldUri from './sprites/gold';

export const SPRITE_KEYS = ['villager', 'sheep', 'tree', 'berries', 'gold'] as const;
export type SpriteKey = (typeof SPRITE_KEYS)[number];

// Sprites are embedded as base64 data-URIs so the app is fully self-contained
// (no external asset fetches) and deployable to any static host / subpath.
const SPRITE_URIS: Record<SpriteKey, string> = {
  villager: villagerUri,
  sheep: sheepUri,
  tree: treeUri,
  berries: berriesUri,
  gold: goldUri,
};

/** Remove the flat magenta chroma-key background and despill purple fringing. */
function keyOutMagenta(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  const data = ctx.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    // "Magenta excess": high red+blue relative to green.
    const m = (r + b) / 2 - g;
    if (m > 55) {
      const a = m > 110 ? 0 : 1 - (m - 55) / 55;
      d[i + 3] = Math.round(d[i + 3] * a);
      // Despill: pull red/blue back toward green so edges aren't purple.
      d[i] = Math.min(r, g + 35);
      d[i + 2] = Math.min(b, g + 35);
    }
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

function loadOne(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const tex = new THREE.CanvasTexture(keyOutMagenta(img));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      tex.needsUpdate = true;
      resolve(tex);
    };
    img.onerror = () => reject(new Error(`Failed to load sprite: ${url}`));
    img.src = url;
  });
}

export async function loadSpriteTextures(): Promise<Record<SpriteKey, THREE.Texture>> {
  const out = {} as Record<SpriteKey, THREE.Texture>;
  await Promise.all(
    SPRITE_KEYS.map(async (k) => {
      out[k] = await loadOne(SPRITE_URIS[k]);
    })
  );
  return out;
}

interface BillboardOptions {
  shadow?: boolean;
  yOffset?: number;
  shadowScale?: number;
}

/**
 * An upright, camera-facing textured quad anchored at ground level, with an
 * optional soft round ground shadow. Gives a 2.5D "sprite on 3D terrain" look.
 */
export class Billboard {
  readonly group = new THREE.Group();
  private plane: THREE.Mesh;
  private flip = 1;

  constructor(texture: THREE.Texture, height: number, opts: BillboardOptions = {}) {
    const image = texture.image as { width: number; height: number };
    const aspect = image.width / image.height;
    const width = height * aspect;

    const geom = new THREE.PlaneGeometry(width, height);
    geom.translate(0, height / 2 + (opts.yOffset ?? 0), 0);
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.35,
      side: THREE.DoubleSide,
      depthWrite: true,
    });
    this.plane = new THREE.Mesh(geom, mat);
    this.group.add(this.plane);

    if (opts.shadow ?? true) {
      const rs = width * 0.3 * (opts.shadowScale ?? 1);
      const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(rs, 20),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false })
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.03;
      this.group.add(shadow);
    }
  }

  setPosition(x: number, y: number, z: number): void {
    this.group.position.set(x, y, z);
  }

  setFlip(flip: boolean): void {
    this.flip = flip ? -1 : 1;
  }

  /** Yaw the quad to face the camera horizontally (stays upright). */
  face(camPos: THREE.Vector3): void {
    this.plane.rotation.y = Math.atan2(
      camPos.x - this.group.position.x,
      camPos.z - this.group.position.z
    );
    this.plane.scale.x = this.flip;
  }
}
