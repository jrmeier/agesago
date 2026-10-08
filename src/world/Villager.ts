import * as THREE from 'three';
import { Terrain } from './Terrain';
import { Billboard } from './Sprites';
import { ResourceNode, ResourceType } from './Resource';

export type UnitStatus = 'Idle' | 'Moving' | 'Gathering' | 'Returning';

export interface EconomyHooks {
  dropPos: () => THREE.Vector2;
  deposit: (type: ResourceType, amount: number) => void;
}

const CARRY_CAP = 10;
const GATHER_RANGE = 1.2;
const DROP_RANGE = 2.4;

/** A villager: walks the terrain, gathers resources, and returns them to the Town Center. */
export class Villager {
  readonly group = new THREE.Group();

  private body?: THREE.Group;
  private billboard?: Billboard;
  private ring: THREE.Mesh;
  private target: THREE.Vector2 | null = null;
  private readonly speed = 3.4;
  private walkPhase = 0;
  private heading = 0;

  private task: 'idle' | 'toNode' | 'gather' | 'toDrop' = 'idle';
  private node: ResourceNode | null = null;
  private carry = 0;
  private carryType: ResourceType | null = null;
  private gatherT = 0;

  status: UnitStatus = 'Idle';
  selected = false;
  pos = new THREE.Vector2();

  constructor(
    private terrain: Terrain,
    startX: number,
    startZ: number,
    private econ: EconomyHooks
  ) {
    this.pos.set(startX, startZ);
    this.body = this.buildFallbackModel();
    this.group.add(this.body);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.45, 0.62, 36),
      new THREE.MeshBasicMaterial({
        color: 0x8affc0,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.07;
    this.ring.visible = false;
    this.group.add(this.ring);

    this.syncTransform();
  }

  private buildFallbackModel(): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x9c7a44, roughness: 0.9, flatShading: true });
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.5, 7), mat);
    torso.position.y = 0.5;
    torso.castShadow = true;
    g.add(torso);
    return g;
  }

  setSprite(texture: THREE.Texture): void {
    if (this.body) {
      this.group.remove(this.body);
      this.body = undefined;
    }
    this.billboard = new Billboard(texture, 1.85, { yOffset: -0.06, shadowScale: 0.7 });
    this.group.add(this.billboard.group);
  }

  setSelected(v: boolean): void {
    this.selected = v;
    this.ring.visible = v;
  }

  worldPosition(): THREE.Vector3 {
    return this.group.position.clone();
  }

  face(camPos: THREE.Vector3): void {
    this.billboard?.face(camPos);
  }

  /** Direct move order — cancels any gathering job. */
  moveTo(x: number, z: number): void {
    this.task = 'idle';
    this.node = null;
    this.target = new THREE.Vector2(x, z);
    this.status = 'Moving';
  }

  /** Assign this villager to harvest a resource node. */
  gather(node: ResourceNode): void {
    this.node = node;
    this.task = 'toNode';
    this.target = node.pos.clone();
    this.status = 'Moving';
  }

  update(dt: number): void {
    if (this.node && this.task !== 'idle') this.runGather(dt);
    if (this.target) this.moveStep(dt);
    this.updateRing();
    this.syncTransform();
  }

  private runGather(dt: number): void {
    const node = this.node!;

    if (this.task === 'toNode') {
      if (!node.alive) {
        this.finishJob();
        return;
      }
      this.target = node.pos.clone();
      this.status = 'Moving';
      if (this.pos.distanceTo(node.pos) <= GATHER_RANGE) {
        this.target = null;
        this.task = 'gather';
        this.gatherT = 0;
      }
    } else if (this.task === 'gather') {
      this.target = null;
      this.status = 'Gathering';
      this.heading = Math.atan2(node.pos.x - this.pos.x, node.pos.y - this.pos.y);
      this.gatherT += dt;
      if (this.gatherT >= 0.5) {
        this.gatherT = 0;
        this.carry += node.take(2);
        this.carryType = node.type;
        if (this.carry >= CARRY_CAP || !node.alive) {
          this.task = 'toDrop';
          this.target = this.econ.dropPos();
        }
      }
    } else if (this.task === 'toDrop') {
      this.status = 'Returning';
      const drop = this.econ.dropPos();
      this.target = drop;
      if (this.pos.distanceTo(drop) <= DROP_RANGE) {
        if (this.carry > 0 && this.carryType) this.econ.deposit(this.carryType, this.carry);
        this.carry = 0;
        if (node.alive) {
          this.task = 'toNode';
        } else {
          this.finishJob();
        }
      }
    }
  }

  private finishJob(): void {
    this.node = null;
    this.task = 'idle';
    this.target = null;
    this.status = 'Idle';
  }

  private moveStep(dt: number): void {
    if (!this.target) return;
    const dir = this.target.clone().sub(this.pos);
    const dist = dir.length();
    if (dist < 0.06) {
      this.pos.copy(this.target);
      this.target = null;
      if (this.task === 'idle') this.status = 'Idle';
      return;
    }
    dir.normalize();
    this.pos.addScaledVector(dir, Math.min(this.speed * dt, dist));
    this.heading = Math.atan2(dir.x, dir.y);
    if (this.body) this.body.rotation.y = this.heading;
    this.walkPhase += dt * 10;
  }

  private updateRing(): void {
    if (!this.ring.visible) return;
    const pulse = 1 + Math.sin(performance.now() * 0.004) * 0.08;
    this.ring.scale.set(pulse, pulse, 1);
  }

  private syncTransform(): void {
    const h = this.terrain.heightAt(this.pos.x, this.pos.y);
    const moving = this.status === 'Moving' || this.status === 'Returning';
    const bob = moving ? Math.abs(Math.sin(this.walkPhase)) * 0.06 : 0;
    this.group.position.set(this.pos.x, h + bob, this.pos.y);
  }
}
