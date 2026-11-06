import { Group, Object3D, Quaternion, Vector3 } from 'three';
import geometry from '../config/characterGeometry.json';
import { tuning, DEG2RAD, type Vec2 } from '../config/bunnyTuning';
import type { ModelKind } from '../world/Actor';
import type { BunnyPose } from '../world/PhysicsLab';
import { twoBone, setWorldRotation, type Limb } from '../render/TwoBoneIK';

const Z = new Vector3(0, 0, 1);
export const CHARACTER_GEOMETRY_VERSION = Object.values(geometry).map(g => g.geometrySha256).join('/');

/** One deterministic skeleton for collision geometry and rendering (also in Node replays). */
export class CharacterSkeleton {
  readonly root = new Group();
  readonly nodes: Object3D[];
  readonly names = new Map<string, Object3D>();
  readonly arms: Limb[] = [];
  readonly legs: Limb[] = [];
  readonly defaultHandDepths: number[];
  readonly data;
  private readonly rotations = new Map<Object3D, Quaternion>();
  private readonly offsets = new Map<Object3D, Vec2>();

  constructor(model: ModelKind, readonly facing: number) {
    this.data = geometry[model];
    const profile = new Group(); profile.position.y = -tuning.core.coreCenter.y;
    profile.rotation.y = this.data.profileYaw * DEG2RAD * facing; this.root.add(profile);
    this.nodes = this.data.nodes.map(n => {
      const node = new Object3D(); node.name = n.name;
      node.position.fromArray(n.p); node.quaternion.fromArray(n.q); node.scale.fromArray(n.s);
      this.names.set(n.name, node); return node;
    });
    this.nodes.forEach((node, i) => (this.nodes[this.data.nodes[i].parent] ?? profile).add(node));
    this.root.updateMatrixWorld(true);
    const bone = (name: string) => this.names.get(name)!;
    const leftNear = bone('UpperArm.L').getWorldPosition(new Vector3()).z > bone('UpperArm.R').getWorldPosition(new Vector3()).z;
    for (const side of ['L', 'R']) {
      const i = (side === 'L') === leftNear ? 0 : 1;
      this.arms[i] = { upper: bone(`UpperArm.${side}`), lower: bone(`Forearm.${side}`), tip: bone(`Mitten.${side}`) };
      this.legs[i] = { upper: bone(`Thigh.${side}`), lower: bone(`Shin.${side}`), tip: bone(`Foot.${side}`) };
    }
    this.defaultHandDepths=this.arms.map(l=>l.upper.getWorldPosition(new Vector3()).z);
    for (const limb of [...this.arms, ...this.legs]) {
      this.rotations.set(limb.tip, limb.tip.getWorldQuaternion(new Quaternion()));
      const vertices = this.vertices(limb.tip.name);
      const min = new Vector3(Infinity, Infinity, Infinity), max = min.clone().negate();
      vertices.forEach(p => { min.min(p); max.max(p); });
      const center = min.add(max).multiplyScalar(.5), origin = limb.tip.getWorldPosition(new Vector3());
      this.offsets.set(limb.tip, { x: origin.x - center.x, y: origin.y - center.y });
    }
  }

  solve(pose: BunnyPose, handLocal: Vec2, handDepths = this.defaultHandDepths): void {
    this.nodes.forEach((node, i) => {
      const n = this.data.nodes[i]; node.position.fromArray(n.p); node.quaternion.fromArray(n.q); node.scale.fromArray(n.s);
    });
    this.root.position.set(pose.core.x, pose.core.y, 0); this.root.rotation.z = pose.core.angle;
    this.root.updateMatrixWorld(true);
    const bend = new Vector3(Math.cos(pose.core.angle) * this.facing, Math.sin(pose.core.angle) * this.facing, 0);
    for (let i = 0; i < 2; i++) {
      this.limb(this.legs[i], pose.legs[i], { x: 0, y: 0 }, bend);
      this.limb(this.arms[i], pose.arms[i], handLocal, new Vector3(Math.sin(pose.core.angle), -Math.cos(pose.core.angle), 0), handDepths[i]);
    }
    this.root.updateMatrixWorld(true);
  }

  private limb(limb: Limb, body: { x: number; y: number; angle: number }, center: Vec2, bend: Vector3, depth = limb.upper.getWorldPosition(new Vector3()).z): void {
    const offset = this.offsets.get(limb.tip)!, c = Math.cos(body.angle), s = Math.sin(body.angle);
    const x = center.x + offset.x, y = center.y + offset.y;
    const target = new Vector3(body.x + x * c - y * s, body.y + x * s + y * c, depth);
    // The physical joint is authoritative, including fully extended limbs.
    twoBone(limb, target, bend, true);
    setWorldRotation(limb.tip, new Quaternion().setFromAxisAngle(Z, body.angle).multiply(this.rotations.get(limb.tip)!));
  }

  vertices(name: string): Vector3[] {
    const region = this.data.regions.find(r => r.name === name);
    if (!region) return [];
    return region.vertices.map(vertex => {
      const p = new Vector3();
      for (const [bone, x, y, z, weight] of vertex) {
        const e=this.nodes[bone].matrixWorld.elements;
        p.x+=(e[0]*x+e[4]*y+e[8]*z+e[12])*weight;
        p.y+=(e[1]*x+e[5]*y+e[9]*z+e[13])*weight;
        p.z+=(e[2]*x+e[6]*y+e[10]*z+e[14])*weight;
      }
      return p;
    });
  }
}
