import { closestPair } from '../../src/physics/Surfaces';
import { outline } from './geometryHelpers';
import { describe, expect, it } from 'vitest';
import { Circle, World } from 'planck';
import { BunnyRig } from '../../src/bunny/BunnyRig';
import { BunnyGrab } from '../../src/bunny/BunnyGrab';
import { Surfaces } from '../../src/physics/Surfaces';
import { tuning } from '../../src/config/bunnyTuning';

function setup(gap: number, sensor = false) {
  const world = new World({ x: 0, y: 0 }), surfaces = new Surfaces(world);
  const rig = new BunnyRig(world, { x: 0, y: 0 }, 1, 1, surfaces, 'sumo');
  const edge=outline(rig.skin.hands[0]).reduce((a,b)=>a.x>b.x?a:b);
  const radius = 0.04;
  const body = world.createBody({ position: { x: edge.x + gap + radius, y: edge.y } });
  const fixture = body.createFixture(new Circle(radius), { isSensor: sensor });
  const surface = surfaces.register(body, { kind: 'circle', radius }, [fixture], 2, sensor);
  return { world, rig, surface, grab: new BunnyGrab(world, rig, surfaces) };
}

describe('contact-only grips', () => {
  it.each([false, true])('does not grab through an air gap (sensor=%s)', sensor => {
    const { grab } = setup(0.04, sensor); grab.step(true);
    expect(grab.holding(0)).toBe(false); expect(grab.holding(1)).toBe(false);
  });

  it.each([false, true])('joins the hand edge directly to the surface (sensor=%s)', sensor => {
    const { world, rig, surface, grab } = setup(0.002, sensor); grab.step(true);
    expect(grab.holding(0)).toBe(true);
    const joint = world.getJointList()!, anchor = joint.getAnchorB(), center = surface.body.getPosition();
    expect(Math.hypot(anchor.x - center.x, anchor.y - center.y)).toBeCloseTo(0.04, 3);
    for (let i = 0; i < 30; i++) {
      rig.core.applyTorque(3); world.step(tuning.dt, tuning.velocityIterations, tuning.positionIterations);
      rig.skin.sync();
      expect(closestPair(rig.skin.hands[0],surface).distance).toBeLessThanOrEqual(.008);
    }
    grab.step(false); expect(grab.holding(0)).toBe(false); expect(grab.holding(1)).toBe(false);
  });
});
