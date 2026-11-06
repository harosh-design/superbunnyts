import { RevoluteJoint, type World } from 'planck';
import { DEG2RAD, tuning } from '../config/bunnyTuning';
import type { Surface, Surfaces } from '../physics/Surfaces';
import type { BunnyRig } from './BunnyRig';

export class BunnyGrab {
  private readonly joints: (RevoluteJoint | null)[] = [null, null];
  readonly held: (Surface | null)[] = [null, null];
  grabbedThisStep = 0;
  reaching = false;

  constructor(private readonly world: World, private readonly rig: BunnyRig, private readonly surfaces: Surfaces) {}
  holding(i: number): boolean { return this.joints[i] !== null; }

  step(want: boolean): void {
    this.reaching = want;
    this.grabbedThisStep = 0;
    for (let i = 0; i < 2; i++) {
      if (!want) { this.release(i); continue; }
      if (this.holding(i)) continue;
      const hand = this.rig.arms[i].getWorldPoint(this.rig.handLocal);
      const hit = this.surfaces.near(hand, tuning.arm.handRadius + tuning.grab.radius, this.rig.id)[0];
      if (!hit) continue;
      const { x, y } = hit.point;
      const dx = x - hand.x, dy = y - hand.y, d = Math.hypot(dx, dy);
      // Join the touching edge of the hand to the surface itself. Both anchors
      // describe the same contact, including on thin objects and ear sensors.
      const contact = d > 1e-4 ? {
        x: hand.x + dx / d * tuning.arm.handRadius,
        y: hand.y + dy / d * tuning.arm.handRadius
      } : hand;
      const joint = new RevoluteJoint({
        bodyA: this.rig.arms[i], bodyB: hit.surface.body,
        localAnchorA: this.rig.arms[i].getLocalPoint(contact),
        localAnchorB: hit.surface.body.getLocalPoint({ x, y }),
        collideConnected: false, enableLimit: false, enableMotor: false
      });
      this.world.createJoint(joint);
      this.joints[i] = joint;
      this.held[i] = hit.surface;
      this.grabbedThisStep++;
    }
  }

  reachAngle(i: number): number {
    const arm = this.rig.arms[i], hand = arm.getWorldPoint(this.rig.handLocal), shoulder = arm.getPosition();
    const vector = { x: hand.x - shoulder.x, y: hand.y - shoulder.y };
    const reach = Math.abs(this.rig.handLocal.x) + tuning.arm.handRadius + tuning.grab.radius;
    for (const hit of this.surfaces.near(shoulder, reach, this.rig.id)) {
      if (hit.distance < 1e-6) continue;
      const to = { x: hit.point.x - shoulder.x, y: hit.point.y - shoulder.y };
      const signed = Math.atan2(vector.x * to.y - vector.y * to.x, vector.x * to.x + vector.y * to.y);
      const target = this.rig.armJoints[i].getJointAngle() - signed;
      if (Math.abs(target) > (tuning.arm.limitDeg + 15) * DEG2RAD) continue;
      return Math.max(-tuning.arm.limitDeg * DEG2RAD, Math.min(tuning.arm.limitDeg * DEG2RAD, target));
    }
    return -tuning.grab.reachAngle * DEG2RAD * this.rig.facing;
  }

  release(i: number): void {
    const joint = this.joints[i];
    if (joint) this.world.destroyJoint(joint);
    this.joints[i] = null;
    this.held[i] = null;
  }
  releaseAll(): void { this.release(0); this.release(1); this.reaching = false; }
}
