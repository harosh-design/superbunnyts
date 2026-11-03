import { World, WeldJoint, type Body, type Contact, type Fixture } from 'planck';
import { tuning, type Vec2 } from '../config/bunnyTuning';
import { emptyInputFrame, type InputFrame } from '../input/InputFrame';
import type { BodyUserData } from '../physics/PartKind';
import { Environment, type SceneId } from './Environment';
import { stepSpring } from './SpringPad';
import { Actor, type DeathCause } from './Actor';
import { Deathmatch, MATCH_RULES, type MatchOptions, type PlayerSlot } from './Deathmatch';

export interface Pose { x: number; y: number; angle: number }
export interface BunnyPose { core: Pose; legs: Pose[]; arms: Pose[]; objects: Pose[] }
export type VisualContext = Pick<Actor, 'rig' | 'grab' | 'contacts' | 'lastImpact' | 'current' | 'environment' | 'alive'>;
interface PendingDeath { cause: DeathCause; killer?: Actor; body?: Body; hazard?: Body }
export class PhysicsLab {
  readonly world = new World(tuning.gravity);
  readonly environment: Environment;
  readonly actors: Actor[] = [];
  readonly players: PlayerSlot[] = [];
  readonly match: Deathmatch | null;
  readonly events = { jumped: false, jumps: 0, grabbed: 0, spring: false, deaths: [] as DeathCause[], respawned: 0, countdown: null as number | null, won: false };
  ticks = 0;
  current: BunnyPose;
  previous: BunnyPose;
  private nextActor = 0;
  private readonly pending = new Map<Actor, PendingDeath>();
  private touching = new Set<string>();
  private fixtureIds = new WeakMap<Fixture, number>();
  private nextFixture = 0;

  constructor(readonly scene: SceneId = 'lab', spawn?: Vec2, readonly options: MatchOptions = {}) {
    this.environment = new Environment(this.world, scene);
    const competitive = scene.startsWith('dm-') && !options.menu;
    const count = competitive || options.menu ? Math.max(2, Math.min(4, options.players ?? 2)) : 1;
    for (let i = 0; i < count; i++) {
      const feet = spawn ?? (count > 1 ? this.environment.spawns[i] ?? { x: i * 2, y: 0 } : this.environment.spawn);
      const actor = this.spawn(i, feet, count > 1 && feet.x > 0 ? -1 : 1);
      this.players.push({ index: i, lives: Math.max(1, Math.min(10, options.lives ?? MATCH_RULES.lives)), kills: 0, actor, respawnAt: -1 });
    }
    this.match = competitive ? new Deathmatch(this.players, options) : null;
    this.current = this.previous = this.capture();
    this.world.on('pre-solve', contact => this.beforeContact(contact));
  }
  get rig() { return this.players[0].actor.rig; }
  get motor() { return this.players[0].actor.motor; }
  get grab() { return this.players[0].actor.grab; }
  get contacts() { return this.players[0].actor.contacts; }
  get lastImpact() { return this.players[0].actor.lastImpact; }
  get alive() { return this.players[0].actor.alive; }
  get time(): number { return this.ticks * tuning.dt; }
  get grounded(): boolean { return this.motor.grounded(this.time); }

  step(controls: InputFrame | InputFrame[]): 'bounds' | 'invalid' | null {
    const inputs = Array.isArray(controls) ? controls : [controls];
    this.events.jumped = this.events.spring = this.events.won = false; this.events.jumps = this.events.grabbed = this.events.respawned = 0;
    this.events.deaths.length = 0; this.events.countdown = null;
    this.updateMatch(inputs);
    this.previous = this.current;
    for (const actor of this.actors) actor.previous = actor.current;
    for (const spring of this.environment.springs) {
      if (stepSpring(this.environment, this.actors.map(a => a.rig), this.time, spring)) this.events.spring = true;
    }
    for (const actor of this.actors) {
      actor.lastImpact = null;
      if (!actor.alive) continue;
      const open = !this.match || this.match.phase === 'playing';
      const input = open ? inputs[actor.player] ?? emptyInputFrame() : emptyInputFrame();
      actor.motor.step(input, this.time); actor.grab.step(input.grabHeld);
      this.events.jumped ||= actor.motor.jumpedThisStep; this.events.jumps += Number(actor.motor.jumpedThisStep); this.events.grabbed += actor.grab.grabbedThisStep;
    }
    this.world.step(tuning.dt, tuning.velocityIterations, tuning.positionIterations); this.ticks++;
    this.actors.forEach(a => { a.contacts.feet.fill(false); a.contacts.hands.fill(false); });
    const touching = new Set<string>();
    for (let c = this.world.getContactList(); c; c = c.getNext()) {
      if (!c.isEnabled() || !c.isTouching()) continue;
      touching.add(this.contactKey(c));
      const pairs = [[c.getFixtureA(), c.getFixtureB()], [c.getFixtureB(), c.getFixtureA()]];
      for (const [fixture, other] of pairs) {
        const data = fixture.getBody().getUserData() as BodyUserData;
        const actor = this.actorFor(fixture.getBody()); if (!actor) continue;
        const role = (fixture.getUserData() as { role?: string })?.role;
        if ((other.getBody().getUserData() as BodyUserData).hazard && role !== 'ear') this.queueKill(actor, { cause: 'hazard', body: fixture.getBody(), hazard: other.getBody() });
        if (fixture.isSensor() || other.isSensor()) continue;
        const i = data.part === 'arm-0' || data.part === 'leg-0' ? 0 : 1;
        const hand = data.part?.startsWith('arm');
        if (!hand || !actor.grab.holding(i)) actor.motor.contact(this.time, !!data.part?.startsWith('leg'));
        if (data.part?.startsWith('leg')) {
          actor.contacts.feet[i] = true;
          const victim = this.actorFor(other.getBody());
          if (victim && victim !== actor && actor.alive && actor.motor.kickActive(this.time)
            && (other.getUserData() as { role?: string })?.role === 'head') this.queueKill(victim, { cause: 'kick', killer: actor });
        }
        if (hand) actor.contacts.hands[i] = true;
      }
    }
    this.touching = touching;
    for (const actor of this.actors) {
      if (actor.lastImpact) actor.motor.impact(this.time, actor.lastImpact.speed);
      const p = actor.rig.core.getPosition(), b = this.environment.bounds;
      if (actor.alive && (p.x < b.x || p.x > b.x + b.width || p.y < b.y || p.y > b.y + b.height)) {
        if (this.match) this.queueKill(actor, { cause: 'bounds' }); else if (!this.options.menu) return 'bounds';
      }
      actor.current = actor.capture();
    }
    this.applyDeaths();
    this.current = this.capture();
    for (let b = this.world.getBodyList(); b; b = b.getNext()) {
      const p = b.getPosition(), v = b.getLinearVelocity();
      if (![p.x, p.y, b.getAngle(), v.x, v.y, b.getAngularVelocity()].every(Number.isFinite)) return 'invalid';
    }
    return null;
  }

  private spawn(player: number, feet: Vec2, facing: number): Actor {
    const actor = new Actor(this.world, this.environment, ++this.nextActor, player, feet, facing, player === 0 ? this.options.model ?? 'bunny' : 'bunny');
    actor.motor.onKick = (bodies, heads, up) => {
      const targets = new Set<Body>(), victims = new Set<Actor>();
      bodies.forEach(body => { const other = this.actorFor(body); if (other) victims.add(other); else targets.add(body); });
      victims.forEach(v => v.rig.bodies.forEach(b => targets.add(b)));
      for (const target of targets) {
        const v = target.getLinearVelocity(), along = -v.x * up.x - v.y * up.y;
        const add = tuning.jump.pushSpeed - Math.min(0, along);
        target.setLinearVelocity({ x: v.x - up.x * add, y: v.y - up.y * add });
      }
      heads.forEach(body => { const victim = this.actorFor(body); if (victim && victim !== actor) this.queueKill(victim, { cause: 'kick', killer: actor }); });
    };
    this.actors.push(actor); return actor;
  }
  private actorFor(body: Body): Actor | undefined {
    const owner = (body.getUserData() as BodyUserData)?.ownerId;
    return owner === undefined ? undefined : this.actors.find(a => a.id === owner);
  }
  private contactKey(c: Contact): string {
    const id = (f: Fixture) => { let id = this.fixtureIds.get(f); if (!id) { id = ++this.nextFixture; this.fixtureIds.set(f, id); } return id; };
    const a = id(c.getFixtureA()), b = id(c.getFixtureB()); return a < b ? `${a}:${b}` : `${b}:${a}`;
  }
  private beforeContact(contact: Contact): void {
    if (this.touching.has(this.contactKey(contact))) return;
    const manifold = contact.getWorldManifold(null); if (!manifold?.pointCount) return;
    const a = contact.getFixtureA(), b = contact.getFixtureB(), point = manifold.points[0];
    // BunnyRig uses Collision2D.relativeVelocity, the bodies' relative linear
    // velocity. Adding angular point velocity would change the relaxation threshold.
    const va = a.getBody().getLinearVelocity(), vb = b.getBody().getLinearVelocity();
    const speed = Math.abs((vb.x - va.x) * manifold.normal.x + (vb.y - va.y) * manifold.normal.y);
    for (const [fixture, other] of [[a, b], [b, a]]) {
      const actor = this.actorFor(fixture.getBody()); if (!actor) continue;
      if (!actor.lastImpact || speed > actor.lastImpact.speed) actor.lastImpact = { speed, x: point.x, y: point.y };
      if (this.match && (fixture.getUserData() as { role?: string })?.role === 'head'
        && other.getFilterCategoryBits() === 2 && speed >= MATCH_RULES.headImpactSpeed) this.queueKill(actor, { cause: 'head' });
    }
  }
  private queueKill(actor: Actor, death: PendingDeath): void {
    if (!this.match || !actor.alive || this.pending.has(actor)) return;
    this.pending.set(actor, death);
  }
  /** Also used by the deterministic test runner to exercise match transitions. */
  eliminate(player: number, cause: DeathCause = 'bounds', killer?: number): void {
    this.queueKill(this.players[player].actor, { cause, killer: killer === undefined ? undefined : this.players[killer].actor }); this.applyDeaths();
  }
  private applyDeaths(): void {
    for (const [actor, death] of this.pending) {
      actor.alive = false; actor.diedAt = this.time; actor.cause = death.cause;
      actor.grab.releaseAll(); actor.motor.goLimp();
      if (death.body && death.hazard) this.world.createJoint(new WeldJoint({ collideConnected: false }, death.body, death.hazard, death.body.getPosition()));
      const player = this.players[actor.player]; player.lives = Math.max(0, player.lives - 1);
      if (death.killer && death.killer !== actor) this.players[death.killer.player].kills++;
      if (player.lives > 0 && this.match?.phase !== 'results') player.respawnAt = this.time + MATCH_RULES.respawnDelay;
      this.events.deaths.push(death.cause);
    }
    this.pending.clear();
    if (this.match && this.match.phase !== 'results') {
      const standing = this.players.filter(p => p.lives > 0 || p.actor.alive);
      if (standing.length <= 1) { this.match.winner = standing[0]?.index ?? null; this.match.phase = 'results'; this.match.resultsSince = this.time; this.events.won = true; }
    }
  }
  private updateMatch(inputs: InputFrame[]): void {
    const match = this.match; if (!match) return;
    if (match.phase === 'countdown') {
      const left = Math.max(0, Math.ceil(MATCH_RULES.countdown - this.time));
      if (left !== match.lastCountdown) { match.lastCountdown = left; this.events.countdown = left; }
      if (this.time >= MATCH_RULES.countdown) match.phase = 'playing';
    } else if (match.phase === 'playing') {
      for (const player of this.players) if (player.respawnAt > 0 && this.time >= player.respawnAt) {
        player.respawnAt = -1;
        const rivals = this.players.filter(p => p !== player && p.actor.alive).map(p => p.actor.rig.core.getPosition());
        const spawns = [...this.environment.spawns];
        const distance = (p: Vec2) => rivals.length ? Math.min(...rivals.map(r => Math.hypot(p.x - r.x, p.y - r.y))) : 0;
        spawns.sort((a, b) => distance(b) - distance(a));
        const spawn = rivals.length ? spawns[0] : spawns[player.index % spawns.length];
        player.actor = this.spawn(player.index, spawn, spawn.x <= 0 ? 1 : -1); this.events.respawned++;
      }
    } else if (this.time - match.resultsSince >= MATCH_RULES.resultsLockout && inputs.some(i => i.jumpPressed)) match.restartRequested = true;
    for (const actor of [...this.actors]) if (!actor.alive && this.time - actor.diedAt >= MATCH_RULES.corpseLifetime) this.removeActor(actor);
  }
  private removeActor(actor: Actor): void {
    for (const other of this.actors) for (let i = 0; i < 2; i++) if (other.grab.held[i]?.ownerId === actor.id) other.grab.release(i);
    actor.grab.releaseAll(); this.environment.surfaces.removeOwner(actor.id); actor.rig.bodies.forEach(b => this.world.destroyBody(b));
    actor.removed = true; this.actors.splice(this.actors.indexOf(actor), 1);
  }
  private capture(): BunnyPose {
    return { ...this.players[0].actor.current, objects: this.environment.objects.map(o => ({ ...o.body.getPosition(), angle: o.body.getAngle() })) };
  }
  dispose(): void { this.actors.forEach(a => a.grab.releaseAll()); }
}
