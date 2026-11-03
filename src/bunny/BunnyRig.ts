import { Circle, PrismaticJoint, RevoluteJoint, type Body, type World } from 'planck';
import { unityMass } from '../config/unityMass';
import { DEG2RAD, tuning, type Vec2 } from '../config/bunnyTuning';
import { capsuleParts } from '../physics/CapsuleShape';
import { bunnyFilter } from '../physics/CollisionFilters';
import { circleArea, circleMass, compositeMassData, stadiumArea, stadiumMass } from '../physics/MassProperties';
import { nextBodyId, type BodyUserData, type PartKind } from '../physics/PartKind';
import type { Surfaces } from '../physics/Surfaces';

export class BunnyRig {
  readonly core: Body;
  readonly legs: Body[] = [];
  readonly arms: Body[] = [];
  readonly legJoints: PrismaticJoint[] = [];
  readonly armJoints: RevoluteJoint[] = [];
  readonly bodies: Body[];
  readonly handLocal: Vec2;

  constructor(world: World, feet: Vec2 = tuning.spawnFeet, readonly id = 1, readonly facing = 1, surfaces?: Surfaces, ears = true) {
    this.handLocal = { x: tuning.arm.handLocal.x * facing, y: 0 };
    const baseY = feet.y + tuning.leg.footSize.y / 2 + tuning.leg.restLength - tuning.leg.hip.y;
    const body = (part: PartKind, x: number, y: number, bullet: boolean) => {
      const data: BodyUserData = { id: nextBodyId(world), part, ownerId: id };
      return world.createDynamicBody({
        position: { x: feet.x + x * facing, y: baseY + y },
        linearDamping: 0.05, angularDamping: 0.05, bullet, userData: data
      });
    };
    const fixture = (friction: number) => ({ ...bunnyFilter(id), friction, restitution: 0, density: 1 });
    const core = tuning.core;
    this.core = body('core', core.coreCenter.x, core.coreCenter.y, core.ccd);
    const radius = core.torsoSize.x / 2;
    const segment = core.torsoSize.y - 2 * radius;
    const torsoFixtures = capsuleParts(radius, segment).map(shape => this.core.createFixture(shape, { ...fixture(core.friction), userData: { role: 'torso' } }));
    const headLocal = { x: core.headLocal.x * facing, y: core.headLocal.y };
    const headFixture = this.core.createFixture(new Circle(headLocal, core.headRadius), { ...fixture(core.friction), userData: { role: 'head' } });
    surfaces?.register(this.core, { kind: 'capsule', width: core.torsoSize.x, height: core.torsoSize.y }, torsoFixtures, id);
    surfaces?.register(this.core, { kind: 'circle', radius: core.headRadius, center: headLocal }, [headFixture], id);
    // Unity distributes a body's mass over its colliders at a common density.
    const area = stadiumArea(radius, segment) + circleArea(core.headRadius);
    const torsoMass = core.mass * stadiumArea(radius, segment) / area;
    const mass = compositeMassData([
      stadiumMass(torsoMass, radius, segment, { x: 0, y: 0 }),
      circleMass(core.mass - torsoMass, core.headRadius, headLocal)
    ]);
    this.core.setMassData({
      mass: mass.mass, center: mass.center,
      I: unityMass.core + mass.mass * (mass.center.x ** 2 + mass.center.y ** 2)
    });

    for (let i = 0; i < 2; i++) {
      const leg = tuning.leg;
      const hip = { x: leg.hip.x + (i === 0 ? leg.legSpread : -leg.legSpread), y: leg.hip.y };
      const foot = body(i === 0 ? 'leg-0' : 'leg-1', hip.x, hip.y - leg.restLength, leg.ccd);
      const r = leg.footSize.y / 2;
      const length = leg.footSize.x - 2 * r;
      const footFixtures = capsuleParts(r, length, true).map(shape => foot.createFixture(shape, fixture(leg.friction)));
      surfaces?.register(foot, { kind: 'capsule', width: leg.footSize.x, height: leg.footSize.y }, footFixtures, id);
      const footMass = stadiumMass(leg.mass, r, length, { x: 0, y: 0 });
      foot.setMassData({ mass: footMass.mass, center: footMass.com, I: unityMass.foot });
      const slide = new PrismaticJoint({
        bodyA: foot, bodyB: this.core,
        localAnchorA: { x: 0, y: 0 },
        localAnchorB: { x: (hip.x - core.coreCenter.x) * facing, y: hip.y - core.coreCenter.y },
        localAxisA: { x: 0, y: 1 }, referenceAngle: 0,
        enableLimit: true, lowerTranslation: leg.limitMin, upperTranslation: leg.limitMax,
        enableMotor: true, maxMotorForce: tuning.legMotor.stand.maxForce, motorSpeed: 0,
        collideConnected: false
      });
      world.createJoint(slide);
      this.legs.push(foot);
      this.legJoints.push(slide);

      const arm = tuning.arm;
      const hand = body(i === 0 ? 'arm-0' : 'arm-1', arm.shoulder.x, arm.shoulder.y, arm.ccd);
      const handFixture = hand.createFixture(new Circle(this.handLocal, arm.handRadius), fixture(arm.friction));
      surfaces?.register(hand, { kind: 'circle', radius: arm.handRadius, center: this.handLocal }, [handFixture], id);
      hand.setMassData({
        mass: arm.mass, center: this.handLocal,
        I: arm.mass * (arm.handRadius ** 2 / 2 + arm.handLocal.x ** 2 + arm.handLocal.y ** 2)
      });
      const hinge = new RevoluteJoint({
        bodyA: hand, bodyB: this.core,
        localAnchorA: { x: 0, y: 0 },
        localAnchorB: { x: (arm.shoulder.x - core.coreCenter.x) * facing, y: arm.shoulder.y - core.coreCenter.y },
        referenceAngle: 0, enableLimit: true,
        lowerAngle: -arm.limitDeg * DEG2RAD, upperAngle: arm.limitDeg * DEG2RAD,
        enableMotor: true, maxMotorTorque: tuning.armMotor.freeTorqueMax, motorSpeed: 0,
        collideConnected: false
      });
      world.createJoint(hinge);
      this.arms.push(hand);
      this.armJoints.push(hinge);
    }
    this.bodies = [this.core, ...this.legs, ...this.arms];
    if (ears) for (const spread of [0.09, -0.09]) {
      const center = { x: (-0.05 + spread - core.coreCenter.x) * facing, y: 1.15 - core.coreCenter.y };
      const ear = this.core.createFixture(new Circle(center, 0.06), { ...fixture(0), density: 0, isSensor: true, userData: { role: 'ear' } });
      surfaces?.register(this.core, { kind: 'circle', radius: 0.06, center }, [ear], id, true);
    }
    // Adding sensor fixtures recomputes mass data; restore the measured collider composition.
    this.core.setMassData({ mass: mass.mass, center: mass.center, I: unityMass.core + mass.mass * (mass.center.x ** 2 + mass.center.y ** 2) });
  }
}
