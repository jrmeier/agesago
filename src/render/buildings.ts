import * as THREE from 'three';

/** Builds a stylized low-poly town center building. */
export function buildTownCenter(baseHeight: number): THREE.Group {
  const g = new THREE.Group();

  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xbfae8e, roughness: 0.95, flatShading: true });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xd8c5a0, roughness: 0.9, flatShading: true });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x9e3b26, roughness: 0.8, flatShading: true });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x5a3d24, roughness: 1, flatShading: true });

  const foundation = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.3, 2.6), stoneMat);
  foundation.position.y = 0.15;

  const walls = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.2, 2.1), wallMat);
  walls.position.y = 0.9;

  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.85, 1.2, 4), roofMat);
  roof.position.y = 2.1;
  roof.rotation.y = Math.PI / 4;

  const door = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.08), woodMat);
  door.position.set(0, 0.68, 1.06);

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 5), woodMat);
  pole.position.set(0.85, 3.05, 0);
  const flag = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.3, 0.02),
    new THREE.MeshStandardMaterial({ color: 0xd4a843, roughness: 0.8, side: THREE.DoubleSide, flatShading: true })
  );
  flag.position.set(1.12, 3.35, 0);

  for (const m of [foundation, walls, roof, door, pole, flag]) {
    m.castShadow = false;
    m.receiveShadow = false;
    g.add(m);
  }

  g.position.y = baseHeight;
  return g;
}
