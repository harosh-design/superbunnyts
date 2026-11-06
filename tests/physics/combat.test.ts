import { placeStomp } from './geometryHelpers';
import { describe, expect, it } from 'vitest';
import { Circle } from 'planck';
import { PhysicsLab } from '../../src/world/PhysicsLab';
import { emptyInputFrame } from '../../src/input/InputFrame';
import { headImpactDamage, MATCH_RULES } from '../../src/world/Deathmatch';
import type { Actor } from '../../src/world/Actor';

function advance(lab: PhysicsLab, ticks: number) {
  for (let i = 0; i < ticks; i++) expect(lab.step(emptyInputFrame())).toBeNull();
}

function move(actor: Actor, x: number, y: number) {
  const origin = actor.rig.core.getPosition().clone();
  for (const body of actor.rig.bodies) {
    const p = body.getPosition();
    body.setTransform({ x: x + p.x - origin.x, y: y + p.y - origin.y }, body.getAngle());
    body.setLinearVelocity({ x: 0, y: 0 }); body.setAngularVelocity(0);
  }
  actor.motor.goLimp();
}

function stomp(speed: number, health = 100) {
  const lab = new PhysicsLab('dm-flat'); advance(lab, 160);
  const attacker = lab.players[0].actor, victim = lab.players[1].actor;
  move(victim, 0, 3); victim.health = health;
  placeStomp(attacker,victim);
  for (const body of attacker.rig.bodies) body.setLinearVelocity({ x: 0, y: -speed });
  advance(lab, 3);
  return { lab, victim, attacker };
}

describe('head impact health', () => {
  it('ignores resting contact and gentle landings on another head', () => {
    for (const speed of [0, 1]) {
      const { lab, victim } = stomp(speed);
      expect(victim.health).toBe(100); expect(lab.players[1].lives).toBe(10);
    }
  });

  it('scales real contact damage with impact speed while leaving the attacker unharmed', () => {
    const slow = stomp(3), medium = stomp(6), fast = stomp(10);
    expect(slow.victim.health).toBeLessThan(100);
    expect(medium.victim.health).toBeLessThan(slow.victim.health);
    expect(fast.victim.health).toBeLessThan(medium.victim.health);
    expect(fast.victim.health).toBeGreaterThan(0);
    for (const result of [slow, medium, fast]) {
      expect(result.attacker.health).toBe(100); expect(result.lab.players[1].lives).toBe(10);
      expect(result.victim.lastHeadHits.size).toBe(1);
      expect(result.victim.damageHits).toHaveLength(1);
      expect(result.victim.damageHits[0].amount).toBeCloseTo(100 - result.victim.health);
      expect(result.attacker.lastStrike?.cause).toBe('kick');
    }
  });

  it('scales with impulse too, and excludes separating contacts', () => {
    expect(headImpactDamage(6, 4)).toBeGreaterThan(headImpactDamage(6, 2));
    expect(headImpactDamage(-8, 20)).toBe(0); expect(headImpactDamage(1, 20)).toBe(0);
  });

  it('counts both feet as one blow, prevents contact drain, and allows another distinct blow', () => {
    const { lab, victim, attacker } = stomp(6);
    const remaining = victim.health;
    placeStomp(attacker,victim);
    for (const body of attacker.rig.bodies) body.setLinearVelocity({ x: 0, y: -6 });
    advance(lab, 3);
    expect(victim.health).toBe(remaining);
    // Separate the fighters for longer than the hit cooldown, then strike again.
    move(attacker, -4, 4); move(victim, 0, 3); advance(lab, 20);
    placeStomp(attacker,victim);
    for (const body of attacker.rig.bodies) body.setLinearVelocity({ x: 0, y: -8 });
    advance(lab, 3);
    expect(victim.health).toBeLessThan(remaining); expect(victim.alive).toBe(true);
  });

  it('loses one life at zero HP, credits the attacker, and respawns with full health', () => {
    const { lab, victim } = stomp(8, 5);
    expect(victim.health).toBe(0); expect(victim.alive).toBe(false); expect(victim.cause).toBe('kick');
    expect(lab.players[1].lives).toBe(9); expect(lab.players[0].kills).toBe(1);
    advance(lab, Math.ceil(MATCH_RULES.respawnDelay / .02) + 2);
    expect(lab.players[1].actor.id).not.toBe(victim.id);
    expect(lab.players[1].actor.health).toBe(MATCH_RULES.maxHealth);
  });

  it('includes rotational contact speed and damage from hands, but ignores corpses and body hits', () => {
    function strike(spin: number, alive = true, hitHead = true) {
      const lab = new PhysicsLab('dm-flat'); advance(lab, 160);
      const attacker = lab.players[0].actor, victim = lab.players[1].actor;
      move(victim, 0, 3); move(attacker, -4, 3); attacker.alive = alive;
      const point = hitHead ? victim.rig.core.getWorldPoint({ x: -0.02, y: 0.34 }) : { x: 0, y: 3 };
      // An isolated enemy hand lets us test a pure rotational blow, with zero
      // linear speed and no shoulder motor contributing to the impulse.
      const arm = lab.world.createDynamicBody({ position: { x: point.x - (hitHead ? 0.21 : 0.235), y: point.y - 0.36 },
        userData: { ownerId: attacker.id, part: 'arm-0' }, angularVelocity: spin });
      arm.createFixture(new Circle({ x: 0, y: 0.36 }, 0.06), { density: 20 });
      advance(lab, 1);
      return victim.health;
    }
    expect(strike(0)).toBe(100);
    expect(strike(-20)).toBeLessThan(100);
    expect(strike(20)).toBe(100); // moving away
    expect(strike(-20, false)).toBe(100);
    expect(strike(-20, true, false)).toBe(100);
  });

  it('does not deal damage during the countdown', () => {
    const lab = new PhysicsLab('dm-flat'), victim = lab.players[1].actor;
    move(victim, 0, 3);
    const head = victim.rig.core.getWorldPoint({ x: -0.02, y: 0.34 });
    move(lab.players[0].actor, head.x - 0.04, head.y + 0.597);
    for (const b of lab.players[0].actor.rig.bodies) b.setLinearVelocity({ x: 0, y: -10 });
    advance(lab, 3); expect(victim.health).toBe(100);
  });
});
