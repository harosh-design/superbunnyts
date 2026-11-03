import type { Body } from 'planck';
import { tuning } from '../config/bunnyTuning';
import type { BunnyRig } from '../bunny/BunnyRig';
import type { Environment } from './Environment';

export function springLift(t: number): number {
  if (t < 0.05) return 0.06 + (0.42 - 0.06) * (1 - (1 - t / 0.05) ** 2);
  t -= 0.05;
  if (t < 0.5) return 0.42 + 0.36 * 0.12 * Math.exp(-9 * t) * Math.sin(38 * t);
  t -= 0.5;
  if (t < 0.45) { const x = t / 0.45; return 0.42 + (0.06 - 0.42) * x * x * (3 - 2 * x); }
  return 0.06;
}

export function stepSpring(env: Environment, rigs: BunnyRig[], now: number, spring = env.spring): boolean {
  if (!spring) return false;
  const up = { x: -Math.sin(spring.angle), y: Math.cos(spring.angle) };
  let launched = false;
  if (now - spring.poppedAt >= 1) {
    const props = new Set<Body>();
    const bunnies = new Set<BunnyRig>();
    for (let edge = spring.pad.getContactList(); edge; edge = edge.next) {
      const contact = edge.contact;
      if (!contact.isEnabled() || !contact.isTouching()) continue;
      const manifold = contact.getWorldManifold(null);
      if (!manifold) continue;
      let top = false;
      for (let i = 0; i < manifold.pointCount; i++) {
        const p = manifold.points[i], pad = spring.pad.getPosition();
        if ((p.x - pad.x) * up.x + (p.y - pad.y) * up.y >= 0.14 / 4) top = true;
      }
      if (!top || !edge.other || edge.other.getType() !== 'dynamic') continue;
      const rig = rigs.find(r => r.bodies.includes(edge.other!));
      if (rig) bunnies.add(rig); else props.add(edge.other);
    }
    const bodies = [...bunnies].flatMap(b => b.bodies).concat([...props]);
    for (const body of bodies) {
      const v = body.getLinearVelocity(), add = Math.max(0, 8 - v.x * up.x - v.y * up.y);
      body.setLinearVelocity({ x: v.x + up.x * add, y: v.y + up.y * add });
    }
    if (bodies.length) { spring.poppedAt = now; launched = true; }
  }
  const lift = springLift(now - spring.poppedAt) + 0.14 / 2;
  const p = spring.pad.getPosition();
  spring.pad.setLinearVelocity({
    x: (spring.origin.x + up.x * lift - p.x) / tuning.dt,
    y: (spring.origin.y + up.y * lift - p.y) / tuning.dt
  });
  return launched;
}
