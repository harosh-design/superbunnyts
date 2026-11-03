import { Polygon, RevoluteJoint, type Body, type World } from 'planck';
import { unityMass } from '../config/unityMass';
import arenaData from '../config/arenas.json';
import { Category } from '../physics/CollisionFilters';
import { nextBodyId } from '../physics/PartKind';
import type { Vec2 } from '../config/bunnyTuning';
import { stadiumMass } from '../physics/MassProperties';
import { Surfaces, type Surface, type SurfaceShape } from '../physics/Surfaces';

export const SCENES = {
  'dm-flat': 'Deathmatch · Flat', 'dm-meadow': 'Deathmatch · Meadow', lab: 'Physics Lab', flat: 'Плоский пол', ledge: 'Выступ', wall: 'Стена',
  prop: 'Динамический предмет', vine: 'Лиана', spring: 'Пружина', 'spring-tilt': 'Пружина 30°'
} as const;
export type SceneId = keyof typeof SCENES;
export interface WorldObject { body: Body; surface: Surface; style: 'floor' | 'block' | 'bag' | 'chain' | 'vine' | 'crate' | 'pad' }

export class Environment {
  readonly surfaces: Surfaces;
  readonly objects: WorldObject[] = [];
  readonly spawn: Vec2;
  readonly floor: Body;
  readonly spawns: Vec2[];
  readonly bounds: { x: number; y: number; width: number; height: number };
  readonly cameraBounds: { x: number; y: number; width: number; height: number };
  readonly springs: { pad: Body; origin: Vec2; angle: number; poppedAt: number }[] = [];
  bag: Body | null = null;
  readonly anchor = { x: 1.1, y: 3.6 };
  get spring() { return this.springs[0] ?? null; }

  constructor(readonly world: World, readonly scene: SceneId) {
    this.surfaces = new Surfaces(world);
    const arena = arenaData.maps.find(a => a.id === (scene === 'dm-flat' ? 'DM_Flat' : scene === 'dm-meadow' ? 'DM_Meadow' : 'PhysicsLab'))!;
    this.bounds = arena.kill; this.cameraBounds = arena.camera; this.spawns = arena.spawns;
    const first = arena.blocks[0];
    this.floor = this.box(first.position, first.size.x, first.size.y, 'floor');
    for (const block of arena.blocks.slice(1)) this.box(block.position, block.size.x, block.size.y, 'floor').setAngle(block.angle * Math.PI / 180);
    if (scene.startsWith('dm-')) {
      for (const s of arena.springs) this.addSpring(s.position, s.angle * Math.PI / 180);
      for (const vine of arena.vines) this.chain(vine.top, vine.segments, 0.12, 0.3, 'vine', 0, 0.5);
      for (const h of arena.hazards) this.hazard(h.position, h.size.x, h.size.y, h.angle * Math.PI / 180);
    }
    this.spawn = scene.startsWith('dm-') ? arena.spawns[0] : scene === 'vine' ? { x: 0, y: 1.6 }
      : scene.startsWith('spring') ? { x: 0, y: 1.5 } : { x: -1.4, y: 0 };
    if (scene === 'lab') {
      const last = this.chain(this.anchor, 4, 0.08, 0.25, 'chain', 0.08, 0.15);
      this.bag = this.capsule({ x: 1.1, y: 1.325 }, 0.7, 1.35, 4, 'bag', 0.08, 0.15);
      this.hinge(this.bag, { x: 0, y: 0.675 }, last, { x: 0, y: -0.2 });
    }
    if (scene === 'ledge') this.box({ x: 0.8, y: 0.65 }, 1.6, 0.2, 'block');
    if (scene === 'wall') this.box({ x: 0.7, y: 1.5 }, 0.3, 3, 'block');
    if (scene === 'prop') this.box({ x: 0.1, y: 0.4 }, 0.7, 0.7, 'crate', 2);
    if (scene === 'vine') this.chain({ x: 0.4, y: 3.2 }, 4, 0.12, 0.3, 'vine', 0, 0.5);
    if (scene.startsWith('spring')) {
      this.addSpring({ x: 0, y: 0 }, scene === 'spring-tilt' ? Math.PI / 6 : 0);
    }
  }

  private addSpring(origin: Vec2, angle: number): void {
    const pad = this.box({ x: origin.x - Math.sin(angle) * 0.13, y: origin.y + Math.cos(angle) * 0.13 }, 0.8, 0.14, 'pad');
    pad.setType('kinematic'); pad.setAngle(angle);
    this.springs.push({ pad, origin, angle, poppedAt: -Infinity });
  }

  private hazard(position: Vec2, width: number, height: number, angle: number): void {
    const body = this.body(position, false); body.setAngle(angle);
    body.setUserData({ ...(body.getUserData() as object), hazard: true });
    const teeth = Math.max(1, Math.round(width / 0.35));
    for (let i = 0; i < teeth; i++) {
      const x = -width / 2 + width * i / teeth, w = width / teeth;
      body.createFixture(new Polygon([{ x, y: -height / 2 }, { x: x + w, y: -height / 2 }, { x: x + w / 2, y: height / 2 }]), { filterCategoryBits: Category.Hazard, friction: 0.4 });
    }
  }

  private box(position: Vec2, width: number, height: number, style: WorldObject['style'], mass = 0): Body {
    const body = this.body(position, mass > 0);
    const surface = this.surfaces.add(body, { kind: 'box', width, height }, 0.4, mass > 0 || style === 'pad');
    if (mass) body.setMassData({ mass, center: { x: 0, y: 0 }, I: mass * (width ** 2 + height ** 2) / 12 });
    this.objects.push({ body, surface, style });
    return body;
  }

  private capsule(position: Vec2, width: number, height: number, mass: number, style: WorldObject['style'], linearDamping: number, angularDamping: number): Body {
    const body = this.body(position, true);
    body.setLinearDamping(linearDamping); body.setAngularDamping(angularDamping);
    const shape: SurfaceShape = { kind: 'capsule', width, height };
    const surface = this.surfaces.add(body, shape, 0.4, true);
    const data = stadiumMass(mass, width / 2, height - width, { x: 0, y: 0 });
    body.setMassData({ mass, center: data.com, I: style === 'bag' ? unityMass.bag : style === 'vine' ? unityMass.vine : unityMass.chain });
    this.objects.push({ body, surface, style });
    return body;
  }

  private body(position: Vec2, dynamic: boolean): Body {
    return this.world.createBody({
      type: dynamic ? 'dynamic' : 'static', position, bullet: dynamic,
      userData: { id: nextBodyId(this.world), part: null }
    });
  }

  private chain(top: Vec2, count: number, width: number, mass: number, style: 'vine' | 'chain', linear: number, angular: number): Body {
    let previous = this.floor;
    for (let i = 0; i < count; i++) {
      const body = this.capsule({ x: top.x, y: top.y - 0.4 * (i + 0.5) }, width, 0.4, mass, style, linear, angular);
      this.hinge(body, { x: 0, y: 0.2 }, previous, i ? { x: 0, y: -0.2 } : previous.getLocalPoint(top));
      previous = body;
    }
    return previous;
  }

  private hinge(a: Body, anchorA: Vec2, b: Body, anchorB: Vec2): void {
    this.world.createJoint(new RevoluteJoint({ bodyA: a, bodyB: b, localAnchorA: anchorA, localAnchorB: anchorB, collideConnected: false }));
  }
}
