import { AABB, Box, Circle, type Body, type Fixture, type World } from 'planck';
import type { Vec2 } from '../config/bunnyTuning';
import { capsuleParts } from './CapsuleShape';
import { Category } from './CollisionFilters';

export type SurfaceShape = ({ kind: 'box'; width: number; height: number }
  | { kind: 'capsule'; width: number; height: number }
  | { kind: 'circle'; radius: number }) & { center?: Vec2 };

export class Surface {
  readonly fixtures: Fixture[] = [];
  constructor(readonly id: number, readonly body: Body, readonly shape: SurfaceShape, readonly ownerId?: number, readonly sensor = false) {}

  closest(worldPoint: Vec2): Vec2 {
    const local = this.body.getLocalPoint(worldPoint), s = this.shape, offset = s.center ?? { x: 0, y: 0 };
    const p = { x: local.x - offset.x, y: local.y - offset.y };
    if (this.sensor) return this.body.getWorldPoint(offset);
    let nearest: Vec2;
    if (s.kind === 'box') {
      nearest = { x: Math.max(-s.width / 2, Math.min(s.width / 2, p.x)), y: Math.max(-s.height / 2, Math.min(s.height / 2, p.y)) };
    } else {
      const r = s.kind === 'circle' ? s.radius : Math.min(s.width, s.height) / 2;
      const half = s.kind === 'circle' ? 0 : Math.max(s.width, s.height) / 2 - r;
      const horizontal = s.kind === 'capsule' && s.width > s.height;
      const axis = horizontal ? { x: Math.max(-half, Math.min(half, p.x)), y: 0 } : { x: 0, y: Math.max(-half, Math.min(half, p.y)) };
      const dx = p.x - axis.x, dy = p.y - axis.y, d = Math.hypot(dx, dy);
      nearest = d <= r ? p : { x: axis.x + dx * r / d, y: axis.y + dy * r / d };
    }
    return this.body.getWorldPoint({ x: nearest.x + offset.x, y: nearest.y + offset.y });
  }

  contains(point: Vec2): boolean {
    const p = this.closest(point);
    return (p.x - point.x) ** 2 + (p.y - point.y) ** 2 < 1e-12;
  }
}

/** Broadphase fixtures map back to one analytic collider, including capsule seams. */
export class Surfaces {
  readonly all: Surface[] = [];
  private readonly byFixture = new Map<Fixture, Surface>();
  private nextId = 0;
  constructor(private readonly world: World) {}

  add(body: Body, shape: SurfaceShape, friction = 0.4, prop = false): Surface {
    const surface = new Surface(++this.nextId, body, shape);
    const shapes = shape.kind === 'box' ? [Box(shape.width / 2, shape.height / 2)]
      : shape.kind === 'circle' ? [new Circle(shape.radius)]
      : capsuleParts(Math.min(shape.width, shape.height) / 2, Math.abs(shape.height - shape.width), shape.width > shape.height);
    for (const primitive of shapes) {
      const fixture = body.createFixture(primitive, {
        friction, restitution: 0, density: 1,
        filterCategoryBits: prop ? Category.Prop : Category.Terrain, filterMaskBits: 0xffff,
        userData: { fixtureId: this.byFixture.size + 1, logicalColliderId: surface.id }
      });
      surface.fixtures.push(fixture);
      this.byFixture.set(fixture, surface);
    }
    this.all.push(surface);
    return surface;
  }

  register(body: Body, shape: SurfaceShape, fixtures: Fixture[], ownerId: number, sensor = false): Surface {
    const surface = new Surface(++this.nextId, body, shape, ownerId, sensor);
    surface.fixtures.push(...fixtures); fixtures.forEach(f => this.byFixture.set(f, surface)); this.all.push(surface); return surface;
  }
  removeOwner(owner: number): void {
    for (let i = this.all.length - 1; i >= 0; i--) if (this.all[i].ownerId === owner) {
      this.all[i].fixtures.forEach(f => this.byFixture.delete(f)); this.all.splice(i, 1);
    }
  }

  near(point: Vec2, radius: number, excludeOwner?: number): { surface: Surface; point: Vec2; distance: number }[] {
    const candidates = new Set<Surface>();
    this.world.queryAABB(new AABB({ x: point.x - radius, y: point.y - radius }, { x: point.x + radius, y: point.y + radius }), fixture => {
      const surface = this.byFixture.get(fixture);
      if (surface && (excludeOwner === undefined || surface.ownerId !== excludeOwner) && (!fixture.isSensor() || surface.sensor)) candidates.add(surface);
      return true;
    });
    return [...candidates].map(surface => {
      const nearest = surface.closest(point);
      return { surface, point: nearest, distance: (nearest.x - point.x) ** 2 + (nearest.y - point.y) ** 2 };
    }).filter(hit => hit.distance <= (radius + (hit.surface.sensor && hit.surface.shape.kind === 'circle' ? hit.surface.shape.radius : 0)) ** 2).sort((a, b) => a.distance - b.distance || a.surface.id - b.surface.id);
  }
}
