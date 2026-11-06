import { Group, Mesh, Object3D, Quaternion, SkinnedMesh, Vector2, Vector3 } from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { ModelKind } from '../world/Actor';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DEG2RAD, tuning } from '../config/bunnyTuning';
import type { VisualContext, BunnyPose } from '../world/PhysicsLab';
import { InertialSpring2D } from './InertialSpring2D';
import { rotateWorld, setWorldRotation, twoBone, type Limb } from './TwoBoneIK';
import type { Surface } from '../physics/Surfaces';

const Z = new Vector3(0, 0, 1), Y = new Vector3(0, 1, 0);
const PROFILE = 65 * DEG2RAD;
interface Bind { rotation: Quaternion; position: Vector3; scale: Vector3 }
interface EarSpring {
  bone: Object3D; axis: Vector3; angle: number; previous: number; speed: number;
  stiffness: number; damping: number; inertia: number;
}

/** Original Bunny skin and the pose rules from the Unity BunnyVisual component. */
export class CharacterVisual {
  readonly root = new Group();
  private readonly bind = new Map<Object3D, Bind>();
  private readonly arms: Limb[] = [];
  private readonly gripVertices: Vector3[][] = [[], []];
  private readonly legs: Limb[] = [];
  private readonly footInModel: Quaternion[] = [];
  private readonly springs: EarSpring[] = [];
  private readonly bellyMotion = new InertialSpring2D();
  private readonly wrists = [new InertialSpring2D(), new InertialSpring2D()];
  private readonly previousBelly = new Vector2();
  private readonly previousWrist = [0, 0];
  private readonly lastArmSpin = [0, 0];
  private readonly lastVelocity = new Vector2();
  private readonly lastBellyVelocity = new Vector2();
  private readonly bellyAnchor: Vector3;
  private readonly pelvis: Object3D;
  private readonly spine: Object3D;
  private readonly belly: Object3D;
  private footGather = 0.5;
  private readonly grip = [0, 0];
  private readonly handClose = [0, 0];
  private readonly heldFor = [-1, -1];

  private static readonly templates = new Map<ModelKind, Group>();
  static async prepare(): Promise<void> {
    await Promise.all((['bunny', 'sumo'] as ModelKind[]).map(async model => {
      if (this.templates.has(model)) return;
      const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}assets/models/${model}.glb`);
      this.templates.set(model, gltf.scene);
    }));
  }
  static create(model: ModelKind = 'bunny', facing = 1, color?: string): CharacterVisual {
    const template = this.templates.get(model);
    if (!template) throw new Error(`Character asset unavailable: ${model}`);
    return new CharacterVisual(clone(template) as Group, facing, color);
  }
  static async load(model: ModelKind = 'bunny', facing = 1, color?: string): Promise<CharacterVisual> {
    await this.prepare(); return this.create(model, facing, color);
  }

  private readonly tissueWeight: number;
  private readonly face: Object3D | undefined;
  private readonly deadFace: Object3D | undefined;
  private constructor(private readonly model: Group, private readonly facing: number, color?: string) {
    this.root.name = 'BunnyVisual';
    this.model.position.set(-tuning.core.coreCenter.x, -tuning.core.coreCenter.y, 0);
    // glTF faces +Z; reflection of Unity's -Z changes the sign of yaw.
    this.model.rotation.y = PROFILE * facing;
    this.root.add(this.model);
    const names = new Map<string, Object3D>();
    model.traverse(node => {
      // GLTFLoader sanitizes dots in node.name; userData keeps the authored bone name.
      names.set(node.userData.name ?? node.name, node);
      this.bind.set(node, { rotation: node.quaternion.clone(), position: node.position.clone(), scale: node.scale.clone() });
      if (node instanceof Mesh) {
        node.material = Array.isArray(node.material) ? node.material.map(m => m.clone()) : node.material.clone();
        if (color) for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          if (material.name.startsWith('Suit') && 'color' in material && material.color && typeof material.color === 'object' && 'set' in material.color) {
            (material.color as import('three').Color).set(color);
          }
        }
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });
    const bone = (name: string): Object3D => {
      const result = names.get(name);
      if (!result) throw new Error(`Bunny model is missing required bone: ${name}`);
      return result;
    };
    this.face = names.get('Face'); this.deadFace = names.get('FaceDead');
    if (this.deadFace) this.deadFace.visible = false;
    const hasEars = names.has('Ear1.L'); this.tissueWeight = hasEars ? 0.6 : 1;
    this.pelvis = bone('Root');
    this.spine = bone('Spine');
    this.belly = bone('Belly');
    bone('Head');
    model.updateWorldMatrix(true, true);
    const leftNear = bone('UpperArm.L').getWorldPosition(new Vector3()).z > bone('UpperArm.R').getWorldPosition(new Vector3()).z;
    for (const side of ['L', 'R']) {
      const i = (side === 'L') === leftNear ? 0 : 1;
      this.arms[i] = { upper: bone(`UpperArm.${side}`), lower: bone(`Forearm.${side}`), tip: bone(`Mitten.${side}`) };
      this.legs[i] = { upper: bone(`Thigh.${side}`), lower: bone(`Shin.${side}`), tip: bone(`Foot.${side}`) };
      if (hasEars) { this.addSpring(bone(`Ear1.${side}`), 160, 9, 9); this.addSpring(bone(`Ear2.${side}`), 110, 6, 12); }
    }
    this.cacheGripVertices();
    if (names.has('Tail')) this.addSpring(bone('Tail'), 220, 12, 5);
    const modelInverse = model.getWorldQuaternion(new Quaternion()).invert();
    for (const leg of this.legs) this.footInModel.push(modelInverse.clone().multiply(leg.tip.getWorldQuaternion(new Quaternion())));
    this.bellyAnchor = this.root.worldToLocal(this.belly.getWorldPosition(new Vector3()));
  }

  reset(lab: VisualContext): void {
    for (const [node, bind] of this.bind) {
      node.position.copy(bind.position); node.quaternion.copy(bind.rotation); node.scale.copy(bind.scale);
    }
    this.bellyMotion.reset(); this.previousBelly.set(0, 0);
    this.wrists.forEach(w => w.reset());
    this.previousWrist.fill(0); this.grip.fill(0); this.handClose.fill(0); this.heldFor.fill(-1); this.footGather = 0.5;
    this.springs.forEach(s => { s.angle = s.previous = s.speed = 0; });
    const v = lab.rig.core.getLinearVelocity();
    this.lastVelocity.set(v.x, v.y);
    this.lastBellyVelocity.copy(this.anchorVelocity(lab));
    lab.rig.arms.forEach((arm, i) => { this.lastArmSpin[i] = arm.getAngularVelocity() / DEG2RAD; });
    this.pose(lab.current, 1, 0, lab);
  }

  /** Runs before the physics solve, matching Unity's visual FixedUpdate phase. */
  fixedUpdate(lab: VisualContext): void {
    const dt = tuning.dt;
    const velocity = lab.rig.core.getLinearVelocity();
    const acceleration = new Vector2(velocity.x, velocity.y).sub(this.lastVelocity).divideScalar(dt);
    this.lastVelocity.set(velocity.x, velocity.y);
    this.previousBelly.copy(this.bellyMotion.offset);
    const anchorVelocity = this.anchorVelocity(lab);
    const delta = anchorVelocity.clone().sub(this.lastBellyVelocity).clampLength(0, 12);
    this.bellyMotion.kick(delta.multiplyScalar(-0.4 * this.tissueWeight));
    this.lastBellyVelocity.copy(anchorVelocity);
    const impact = lab.lastImpact;
    if (impact && impact.speed >= 1.2) {
      const direction = new Vector2(lab.rig.core.getPosition().x - impact.x, lab.rig.core.getPosition().y - impact.y).normalize();
      this.bellyMotion.kick(direction.multiplyScalar(Math.min(impact.speed, 10) * 0.12 * this.tissueWeight));
    }
    this.bellyMotion.step(dt, 3, 0.32, 0.055 * this.tissueWeight, new Vector2(0, tuning.gravity.y * 0.4 * this.tissueWeight));
    for (let i = 0; i < 2; i++) {
      this.previousWrist[i] = this.wrists[i].offset.x;
      const spin = lab.rig.arms[i].getAngularVelocity() / DEG2RAD;
      this.wrists[i].kick(new Vector2(Math.max(-180, Math.min(180, -(spin - this.lastArmSpin[i]) * 0.16)), 0));
      this.lastArmSpin[i] = spin;
      this.wrists[i].step(dt, 3.8, 0.45, 16);
    }
    const angle = lab.rig.core.getAngle(), spin = lab.rig.core.getAngularVelocity() / DEG2RAD;
    for (const s of this.springs) {
      s.previous = s.angle;
      const along = s.axis.clone().applyAxisAngle(Z, angle + s.angle * DEG2RAD);
      const felt = acceleration.clone().negate().add(new Vector2(0, tuning.gravity.y * 0.3));
      const push = (along.x * felt.y - along.y * felt.x) * s.inertia * 0.01 - spin * 0.002 * s.inertia;
      const steps = Math.ceil(dt / (1 / 240)), h = dt / steps;
      for (let j = 0; j < steps; j++) {
        s.speed += (push * 60 - s.stiffness * s.angle - s.damping * s.speed) * h;
        const next = s.angle + s.speed * h;
        s.angle = Math.max(-70, Math.min(70, next));
        if (next !== s.angle && Math.sign(s.speed) === Math.sign(next)) s.speed = 0;
      }
    }
  }

  pose(pose: BunnyPose, alpha: number, delta: number, lab: VisualContext): void {
    const core = pose.core;
    if (this.face) this.face.visible = lab.alive;
    if (this.deadFace) this.deadFace.visible = !lab.alive;
    this.root.position.set(core.x, core.y, 0);
    this.root.rotation.set(0, 0, core.angle);
    this.root.updateWorldMatrix(true, true);
    this.restore(this.pelvis); this.restore(this.spine);
    const modelRotation = this.model.getWorldQuaternion(new Quaternion());
    const up = new Vector3(-Math.sin(core.angle), Math.cos(core.angle), 0);
    const hipTwist = new Quaternion().setFromAxisAngle(up, 25 * DEG2RAD * this.facing);
    rotateWorld(this.pelvis, hipTwist);
    rotateWorld(this.spine, hipTwist.clone().invert());
    const bellyOffset = this.previousBelly.clone().lerp(this.bellyMotion.offset, alpha);
    const bellyParent = this.belly.parent!;
    const parentRotation = bellyParent.getWorldQuaternion(new Quaternion()).invert();
    this.belly.position.copy(this.bind.get(this.belly)!.position)
      .add(new Vector3(bellyOffset.x, bellyOffset.y, 0).applyQuaternion(parentRotation));
    this.belly.updateWorldMatrix(false, true);

    const blend = 1 - Math.exp(-12 * delta);
    const [frontDown, backDown] = lab.contacts.feet;
    const gather = frontDown === backDown ? 0.5 : frontDown ? 0 : 1;
    this.footGather += (gather - this.footGather) * blend;
    const foot = new Vector2(pose.legs[0].x, pose.legs[0].y).lerp(new Vector2(pose.legs[1].x, pose.legs[1].y), this.footGather);
    if (frontDown || backDown) foot.y = frontDown && backDown ? Math.min(pose.legs[0].y, pose.legs[1].y) : frontDown ? pose.legs[0].y : pose.legs[1].y;
    for (let i = 0; i < 2; i++) {
      const leg = this.legs[i];
      this.restore(leg.upper); this.restore(leg.lower);
      const target = new Vector3(foot.x, foot.y, leg.tip.getWorldPosition(new Vector3()).z);
      twoBone(leg, target, new Vector3(Math.cos(core.angle) * this.facing, Math.sin(core.angle) * this.facing, 0));
      setWorldRotation(leg.tip, hipTwist.clone().multiply(modelRotation).multiply(this.footInModel[i]));
    }
    for (let i = 0; i < 2; i++) {
      const arm = this.arms[i];
      // Grip-only reach adjustment must start from authored lengths each frame.
      arm.lower.position.copy(this.bind.get(arm.lower)!.position);
      arm.tip.position.copy(this.bind.get(arm.tip)!.position);
      this.restore(arm.upper); this.restore(arm.lower); this.restore(arm.tip);
      const physical = pose.arms[i];
      const handVector = new Vector3(lab.rig.handLocal.x * Math.cos(physical.angle), lab.rig.handLocal.x * Math.sin(physical.angle), 0);
      const shoulder = arm.upper.getWorldPosition(new Vector3());
      const alongside = shoulder.clone().add(handVector);
      const hand = new Vector3(physical.x, physical.y, shoulder.z).add(handVector);
      const holding = lab.grab.holding(i);
      const pressing = holding || lab.contacts.hands[i] || lab.environment.surfaces.near(alongside, tuning.arm.handRadius, lab.rig.id).length > 0;
      this.handClose[i] = holding ? 1 : this.handClose[i] + ((lab.grab.reaching ? -1 : 0) - this.handClose[i]) * blend;
      this.heldFor[i] = holding ? Math.max(0, this.heldFor[i]) + delta : -1;
      this.grip[i] = holding ? 1 : this.grip[i] + ((pressing ? 1 : 0) - this.grip[i]) * blend;
      const target = alongside.lerp(hand, this.grip[i]);
      for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt > 0) {
          arm.lower.position.copy(this.bind.get(arm.lower)!.position);
          arm.tip.position.copy(this.bind.get(arm.tip)!.position);
          this.restore(arm.upper); this.restore(arm.lower); this.restore(arm.tip);
        }
        twoBone(arm, target, up.clone().negate(), holding);
        this.poseHand(i, alpha, lab);
        if (!holding) break;
        // Bone origins and glove sizes differ between Bunny and Sumo. Bring the
        // actual glove surface into contact, rather than leaving a collider gap.
        const offset = this.gripOffset(i, lab.grab.held[i]!, alpha);
        if (offset.lengthSq() < 1e-6) break;
        target.add(offset);
      }
    }
    for (const s of this.springs) {
      this.restore(s.bone);
      rotateWorld(s.bone, new Quaternion().setFromAxisAngle(Z, (s.previous + (s.angle - s.previous) * alpha) * DEG2RAD));
    }
    this.root.updateWorldMatrix(true, true);
  }

  private cacheGripVertices(): void {
    this.root.updateMatrixWorld(true);
    for (let i = 0; i < 2; i++) {
      const tip = this.arms[i].tip, vertices: Vector3[] = [];
      this.model.traverse(node => {
        if (!(node instanceof SkinnedMesh)) return;
        const bone = node.skeleton.bones.findIndex(b => b === tip);
        if (bone < 0) return;
        const indices = node.geometry.getAttribute('skinIndex'), weights = node.geometry.getAttribute('skinWeight');
        for (let vertex = 0; vertex < indices.count; vertex++) {
          let influence = 0;
          for (let k = 0; k < 4; k++) if (indices.getComponent(vertex, k) === bone) influence += weights.getComponent(vertex, k);
          if (influence < 0.99) continue;
          vertices.push(tip.worldToLocal(node.localToWorld(node.getVertexPosition(vertex, new Vector3()))));
        }
      });
      // A small set of actual surface vertices bounds the glove in 26 directions.
      const samples = new Set<Vector3>();
      for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
        if ((!x && !y && !z) || !vertices.length) continue;
        const direction = new Vector3(x, y, z);
        samples.add(vertices.reduce((best, p) => p.dot(direction) > best.dot(direction) ? p : best));
      }
      this.gripVertices[i] = [...samples];
    }
  }

  private gripOffset(i: number, surface: Surface, alpha: number): Vector3 {
    const offset = new Vector3(); let distance = Infinity;
    for (const vertex of this.gripVertices[i]) {
      const p = this.arms[i].tip.localToWorld(vertex.clone()), nearest = surface.closestAt(p, alpha);
      const dx = nearest.x - p.x, dy = nearest.y - p.y, d = dx * dx + dy * dy;
      if (d < distance) { distance = d; offset.set(dx, dy, 0); }
    }
    return offset;
  }

  private poseHand(i: number, alpha: number, lab: VisualContext): void {
    const arm = this.arms[i];
    const wrist = arm.tip.getWorldPosition(new Vector3());
    const along = wrist.clone().sub(arm.lower.getWorldPosition(new Vector3()));
    along.z = 0; along.normalize();
    let bend = 25 * this.facing * -this.handClose[i] * DEG2RAD;
    if (this.handClose[i] > 0) {
      const palm = new Vector2(along.y * this.facing, -along.x * this.facing);
      const surface = lab.grab.held[i];
      const nearest = surface?.closestAt(wrist, alpha);
      const onto = nearest ? new Vector2(nearest.x - wrist.x, nearest.y - wrist.y) : palm;
      if (onto.lengthSq() < 1e-6) onto.copy(palm);
      const signed = Math.atan2(along.x * onto.y - along.y * onto.x, along.x * onto.x + along.y * onto.y);
      bend = Math.max(-50 * DEG2RAD, Math.min(50 * DEG2RAD, signed)) * this.handClose[i];
    }
    bend += (this.previousWrist[i] + (this.wrists[i].offset.x - this.previousWrist[i]) * alpha)
      * (1 - this.grip[i]) * (1 - Math.abs(this.handClose[i])) * DEG2RAD;
    const dir = along.clone().applyAxisAngle(Z, bend);
    const end = wrist.clone().addScaledVector(dir, 0.065);
    lab.environment.world.rayCast(wrist, end, (fixture, _point, normal, fraction) => {
      if (fixture.isSensor() || lab.rig.bodies.includes(fixture.getBody()) || fraction * 0.065 <= 1e-4) return -1;
      const surface = new Vector2(-normal.y, normal.x);
      if (surface.x * dir.x + surface.y * dir.y < 0) surface.negate();
      bend = Math.atan2(along.x * surface.y - along.y * surface.x, along.x * surface.x + along.y * surface.y);
      return fraction;
    });
    rotateWorld(arm.tip, new Quaternion().setFromAxisAngle(Z, bend));
    const squeeze = this.heldFor[i] >= 0 && this.heldFor[i] < 0.18 ? Math.sin(Math.PI * this.heldFor[i] / 0.18) : 0;
    arm.tip.scale.copy(this.bind.get(arm.tip)!.scale).multiplyScalar(1 + 0.3 * squeeze);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.model.traverse(node => {
      if (node instanceof Mesh) {
        (Array.isArray(node.material) ? node.material : [node.material]).forEach(m => m.dispose());
        if ('skeleton' in node) (node as import('three').SkinnedMesh).skeleton.dispose();
      }
    });
  }

  private restore(node: Object3D): void {
    node.quaternion.copy(this.bind.get(node)!.rotation);
    node.updateWorldMatrix(false, true);
  }

  private addSpring(bone: Object3D, stiffness: number, damping: number, inertia: number): void {
    const axis = Y.clone().applyQuaternion(bone.getWorldQuaternion(new Quaternion()));
    this.springs.push({ bone, axis, stiffness, damping, inertia, angle: 0, previous: 0, speed: 0 });
  }

  private anchorVelocity(lab: VisualContext): Vector2 {
    const core = lab.rig.core, angle = core.getAngle(), p = core.getPosition();
    const point = {
      x: p.x + this.bellyAnchor.x * Math.cos(angle) - this.bellyAnchor.y * Math.sin(angle),
      y: p.y + this.bellyAnchor.x * Math.sin(angle) + this.bellyAnchor.y * Math.cos(angle)
    };
    const v = core.getLinearVelocityFromWorldPoint(point);
    return new Vector2(v.x, v.y);
  }
}
