import { DEG2RAD, tuning } from '../config/bunnyTuning';
import type { InputFrame } from '../input/InputFrame';
import type { BunnyRig } from './BunnyRig';
import type { BunnyGrab } from './BunnyGrab';
import type { Body } from 'planck';

export class BunnyMotor {
  private lastFootContact = -Infinity;
  private lastSurfaceContact = -Infinity;
  private lastJump = -Infinity;
  private legsExtendUntil = -Infinity;
  private armsRelaxUntil = -Infinity;
  private armStrength = 1;

  jumpedThisStep = false;
  onKick: ((bodies: Set<Body>, heads: Set<Body>, up: { x: number; y: number }) => void) | null = null;
  goLimp(): void {
    this.rig.legJoints.forEach(j => j.enableMotor(false));
    this.rig.armJoints.forEach(j => j.enableMotor(false));
  }
  constructor(private readonly rig: BunnyRig, private readonly grab?: BunnyGrab) {}

  grounded(now: number): boolean { return now - this.lastFootContact <= tuning.groundedDelay; }
  onSurface(now: number): boolean { return now - this.lastSurfaceContact <= tuning.surfaceDelay; }

  contact(now: number, foot: boolean): void {
    this.lastSurfaceContact = now;
    if (foot) this.lastFootContact = now;
  }

  impact(now: number, speed: number): void {
    if (speed > tuning.armMotor.impactSpeed) this.armsRelaxUntil = now + tuning.armMotor.relaxFor;
  }

  step(input: InputFrame, now: number): void {
    this.jumpedThisStep = false;
    const core = this.rig.core;
    if (input.roll) core.applyTorque(-input.roll * (this.onSurface(now) ? tuning.roll.onSurface : tuning.roll.inAir), true);
    const maxSpin = tuning.maxSpinDeg * DEG2RAD;
    if (Math.abs(core.getAngularVelocity()) > maxSpin) core.setAngularVelocity(clamp(core.getAngularVelocity(), maxSpin));
    if (input.jumpPressed && this.grounded(now) && now - this.lastJump >= tuning.jump.minInterval) this.jump(now);

    const mode = now < this.legsExtendUntil ? tuning.legMotor.extend
      : input.roll || !this.grounded(now) ? tuning.legMotor.fold : tuning.legMotor.stand;
    for (const joint of this.rig.legJoints) {
      joint.setMaxMotorForce(mode.maxForce);
      joint.setMotorSpeed(clamp(tuning.legMotor.gain * (mode.target - joint.getJointTranslation()), mode.speedLimit));
    }

    const arm = tuning.armMotor;
    const target = this.grounded(now) && !input.roll && now >= this.armsRelaxUntil ? 1 : 0;
    this.armStrength += (target - this.armStrength) * (1 - Math.exp(-arm.strengthRate * tuning.dt));
    const gain = arm.freeGainMin + (arm.freeGainMax - arm.freeGainMin) * this.armStrength;
    const torque = arm.freeTorqueMin + (arm.freeTorqueMax - arm.freeTorqueMin) * this.armStrength;
    for (let i = 0; i < this.rig.armJoints.length; i++) {
      const joint = this.rig.armJoints[i];
      if (this.grab?.holding(i)) {
        joint.setMotorSpeed(0); joint.setMaxMotorTorque(tuning.grab.holdFriction);
      } else {
        const target = input.grabHeld ? this.grab?.reachAngle(i) ?? 0 : 0;
        joint.setMotorSpeed((input.grabHeld ? tuning.grab.reachGain : gain) * (target - joint.getJointAngle()));
        joint.setMaxMotorTorque(input.grabHeld ? tuning.grab.reachTorque : torque);
      }
    }
  }

  private jump(now: number): void {
    const angle = this.rig.core.getAngle();
    const up = { x: -Math.sin(angle), y: Math.cos(angle) };
    // Real sole contacts only; each dynamic prop gets the kick once, even under both feet.
    const props = new Set<Body>();
    const heads = new Set<Body>();
    for (const leg of this.rig.legs) {
      for (let edge = leg.getContactList(); edge; edge = edge.next) {
        if (edge.other && edge.contact.isEnabled() && edge.contact.isTouching() && edge.other.getType() === 'dynamic'
          && !this.rig.bodies.includes(edge.other)) {
          props.add(edge.other);
          const fixture = edge.contact.getFixtureA().getBody() === leg ? edge.contact.getFixtureB() : edge.contact.getFixtureA();
          if ((fixture.getUserData() as { role?: string })?.role === 'head') heads.add(edge.other);
        }
      }
    }
    if (this.onKick) this.onKick(props, heads, up);
    else for (const prop of props) {
      const v = prop.getLinearVelocity(), along = -v.x * up.x - v.y * up.y;
      const add = tuning.jump.pushSpeed - Math.min(0, along);
      prop.setLinearVelocity({ x: v.x - up.x * add, y: v.y - up.y * add });
    }
    for (const body of this.rig.bodies) {
      const velocity = body.getLinearVelocity();
      const along = velocity.x * up.x + velocity.y * up.y;
      const cancel = tuning.jump.cancelDownward && along < 0 ? along : 0;
      body.setLinearVelocity({
        x: velocity.x + up.x * (tuning.jump.speed - cancel),
        y: velocity.y + up.y * (tuning.jump.speed - cancel)
      });
    }
    this.lastJump = now;
    this.jumpedThisStep = true;
    this.legsExtendUntil = now + tuning.jump.legsExtendFor;
    this.armsRelaxUntil = now + tuning.jump.armsRelaxFor;
  }
}

function clamp(value: number, limit: number): number { return Math.max(-limit, Math.min(limit, value)); }
