import type { World } from 'planck';
import { BunnyRig } from '../bunny/BunnyRig';
import { BunnyMotor } from '../bunny/BunnyMotor';
import { BunnyGrab } from '../bunny/BunnyGrab';
import type { Vec2 } from '../config/bunnyTuning';
import type { Environment } from './Environment';
import type { BunnyPose } from './PhysicsLab';
import { MATCH_RULES } from './Deathmatch';

export type ModelKind = 'bunny' | 'sumo';
export type DeathCause = 'hazard' | 'bounds' | 'head' | 'kick';
export const PLAYER_COLORS = ['#e63021', '#fac738', '#5cc76b', '#947adb'];

export class Actor {
  readonly rig: BunnyRig;
  readonly grab: BunnyGrab;
  readonly motor: BunnyMotor;
  readonly contacts = { feet: [false, false], hands: [false, false] };
  lastImpact: { speed: number; x: number; y: number } | null = null;
  alive = true;
  health: number = MATCH_RULES.maxHealth;
  lastHurtAt = -Infinity;
  readonly lastHeadHits = new Map<number, number>();
  diedAt = -Infinity;
  removed = false;
  cause: DeathCause | null = null;
  current: BunnyPose;
  previous: BunnyPose;
  constructor(world: World, readonly environment: Environment, readonly id: number, readonly player: number, spawn: Vec2, facing: number, readonly model: ModelKind = 'bunny') {
    this.rig = new BunnyRig(world, spawn, id, facing, environment.surfaces, model === 'bunny');
    this.grab = new BunnyGrab(world, this.rig, environment.surfaces);
    this.motor = new BunnyMotor(this.rig, this.grab);
    this.current = this.previous = this.capture();
  }
  capture(): BunnyPose {
    const pose = (b: typeof this.rig.core) => ({ ...b.getPosition(), angle: b.getAngle() });
    return { core: pose(this.rig.core), legs: this.rig.legs.map(pose), arms: this.rig.arms.map(pose), objects: [] };
  }
}
