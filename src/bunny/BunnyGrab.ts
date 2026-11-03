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
      let { x, y } = hit.point;
      const dx = hand.x - x, dy = hand.y - y, d = Math.hypot(dx, dy);
      if (!hit.surface.sensor && d > 1e-4) {
        const away = { x: dx / d, y: dy / d };
        const thin = !hit.surface.contains({ x: x - away.x * 2.5 * tuning.arm.handRadius, y: y - away.y * 2.5 * tuning.arm.handRadius });
        x += away.x * tuning.arm.handRadius * (thin ? -1 : 1);
        y += away.y * tuning.arm.handRadius * (thin ? -1 : 1);
      } else if (!hit.surface.sensor) { x = hand.x; y = hand.y; }
      const joint = new RevoluteJoint({
        bodyA: this.rig.arms[i], bodyB: hit.surface.body,
        localAnchorA: this.rig.handLocal,
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
