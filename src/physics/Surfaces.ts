import { AABB, Box, Circle, Polygon, type Body, type Fixture, type World } from 'planck';
import type { Vec2 } from '../config/bunnyTuning';
import { capsuleParts } from './CapsuleShape';
import { Category } from './CollisionFilters';

export type SurfaceShape = ({ kind: 'box'; width: number; height: number }
  | { kind: 'capsule'; width: number; height: number }
  | { kind: 'circle'; radius: number }
  | { kind: 'polygon'; vertices: Vec2[]; depths?: number[] }) & { center?: Vec2 };

export class Surface {
  readonly fixtures: Fixture[] = [];
  private previousPosition: Vec2;
  private previousAngle: number;
  constructor(readonly id: number, readonly body: Body, readonly shape: SurfaceShape, readonly ownerId?: number, readonly sensor = false) {
    this.previousPosition = { ...body.getPosition() }; this.previousAngle = body.getAngle();
  }

  capturePrevious(): void {
    this.previousPosition = { ...this.body.getPosition() }; this.previousAngle = this.body.getAngle();
  }

  /** Interpolate rigid body motion; deforming skin outlines use the shared skeletal solve. */
  closestAt(point: Vec2, alpha: number): Vec2 {
    if (alpha === 1) return this.closest(point);
    const current = this.body.getPosition(), angle = this.previousAngle + (this.body.getAngle() - this.previousAngle) * alpha;
    const x = this.previousPosition.x + (current.x - this.previousPosition.x) * alpha;
    const y = this.previousPosition.y + (current.y - this.previousPosition.y) * alpha;
    const c = Math.cos(angle), s = Math.sin(angle), dx = point.x - x, dy = point.y - y;
    const physical = this.body.getWorldPoint({ x: dx * c + dy * s, y: -dx * s + dy * c });
    const nearest = this.body.getLocalPoint(this.closest(physical));
    return { x: x + nearest.x * c - nearest.y * s, y: y + nearest.x * s + nearest.y * c };
  }

  closest(worldPoint: Vec2, boundary = false): Vec2 {
    const local = this.body.getLocalPoint(worldPoint), s = this.shape, offset = s.center ?? { x: 0, y: 0 };
    const p = { x: local.x - offset.x, y: local.y - offset.y };
    let nearest: Vec2;
    if (s.kind === 'polygon') {
      let inside = true, best = Infinity; nearest = p;
      for (let i = 0; i < s.vertices.length; i++) {
        const a = s.vertices[i], b = s.vertices[(i + 1) % s.vertices.length];
        const dx = b.x-a.x, dy = b.y-a.y;
        if (dx*(p.y-a.y)-dy*(p.x-a.x) < -1e-9) inside = false;
        const t = Math.max(0, Math.min(1, ((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));
        const q = { x:a.x+t*dx, y:a.y+t*dy }, d=(q.x-p.x)**2+(q.y-p.y)**2;
        if(d<best) { best=d; nearest=q; }
      }
      if(inside&&!boundary) nearest=p;
    } else if (s.kind === 'box') {
      nearest = { x: Math.max(-s.width / 2, Math.min(s.width / 2, p.x)), y: Math.max(-s.height / 2, Math.min(s.height / 2, p.y)) };
      if(boundary&&Math.abs(p.x)<s.width/2&&Math.abs(p.y)<s.height/2) {
        if(s.width/2-Math.abs(p.x)<s.height/2-Math.abs(p.y))nearest.x=(Math.sign(p.x)||1)*s.width/2;else nearest.y=(Math.sign(p.y)||1)*s.height/2;
      }
    } else {
      const r = s.kind === 'circle' ? s.radius : Math.min(s.width, s.height) / 2;
      const half = s.kind === 'circle' ? 0 : Math.max(s.width, s.height) / 2 - r;
      const horizontal = s.kind === 'capsule' && s.width > s.height;
      const axis = horizontal ? { x: Math.max(-half, Math.min(half, p.x)), y: 0 } : { x: 0, y: Math.max(-half, Math.min(half, p.y)) };
      const dx = p.x - axis.x, dy = p.y - axis.y, d = Math.hypot(dx, dy);
      nearest = d <= r&&!boundary ? p : d<1e-9 ? {x:axis.x+r,y:axis.y} : { x: axis.x + dx * r / d, y: axis.y + dy * r / d };
    }
    return this.body.getWorldPoint({ x: nearest.x + offset.x, y: nearest.y + offset.y });
  }

  /** Z of the actual skin contour at a 2D contact; physics remains in XY. */
  depthAt(point: Vec2): number {
    const shape=this.shape;if(shape.kind!=='polygon'||!shape.depths)return 0;
    const p=this.body.getLocalPoint(point);let best=Infinity,depth=0;
    for(let i=0;i<shape.vertices.length;i++) {
      const j=(i+1)%shape.vertices.length,a=shape.vertices[i],b=shape.vertices[j],dx=b.x-a.x,dy=b.y-a.y;
      const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));
      const d=(p.x-a.x-t*dx)**2+(p.y-a.y-t*dy)**2;
      if(d<best){best=d;depth=shape.depths[i]+t*(shape.depths[j]-shape.depths[i]);}
    }
    return depth;
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

  capturePrevious(): void { this.all.forEach(surface => surface.capturePrevious()); }

  add(body: Body, shape: SurfaceShape, friction = 0.4, prop = false): Surface {
    const surface = new Surface(++this.nextId, body, shape);
    const shapes = shape.kind === 'polygon' ? [new Polygon(shape.vertices)] : shape.kind === 'box' ? [Box(shape.width / 2, shape.height / 2)]
      : shape.kind === 'circle' ? [new Circle(shape.radius)]
      : capsuleParts(Math.min(shape.width, shape.height) / 2, Math.abs(shape.height - shape.width), shape.width > shape.height);
    for (const primitive of shapes) {
      if(primitive instanceof Polygon)primitive.m_radius=0;
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
  replaceFixtures(surface: Surface, fixtures: Fixture[]): void {
    surface.fixtures.forEach(f => this.byFixture.delete(f));
    surface.fixtures.splice(0, surface.fixtures.length, ...fixtures);
    fixtures.forEach(f => this.byFixture.set(f, surface));
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
    }).filter(hit => hit.distance <= radius ** 2).sort((a, b) => a.distance - b.distance || a.surface.id - b.surface.id);
  }
}

/** Closest actual surface points, including edge/edge crossings. */
export function closestPair(a: Surface, b: Surface): { a: Vec2; b: Vec2; distance: number } {
  const outline=(surface:Surface):Vec2[]=>{
    const s=surface.shape,center=s.center??{x:0,y:0};
    const points:Vec2[]=s.kind==='polygon'?s.vertices:s.kind==='box'?
      [{x:-s.width/2,y:-s.height/2},{x:s.width/2,y:-s.height/2},{x:s.width/2,y:s.height/2},{x:-s.width/2,y:s.height/2}]:
      Array.from({length:64},(_,i)=>{
        const angle=i*Math.PI/32,r=s.kind==='circle'?s.radius:Math.min(s.width,s.height)/2;
        const h=s.kind==='circle'?0:Math.abs(s.width-s.height)/2;
        return {x:r*Math.cos(angle)+(s.kind==='capsule'&&s.width>s.height?Math.sign(Math.cos(angle))*h:0),
          y:r*Math.sin(angle)+(s.kind==='capsule'&&s.height>s.width?Math.sign(Math.sin(angle))*h:0)};
      });
    return points.map(p=>surface.body.getWorldPoint({x:p.x+center.x,y:p.y+center.y}));
  };
  const av=outline(a),bv=outline(b);let best={a:av[0],b:b.closest(av[0]),distance:Infinity};
  const consider=(p:Vec2,q:Vec2)=>{const d=Math.hypot(q.x-p.x,q.y-p.y);if(d<best.distance)best={a:p,b:q,distance:d};};
  av.forEach(p=>consider(p,b.closest(p)));bv.forEach(p=>consider(a.closest(p),p));
  for(let i=0;i<av.length;i++)for(let j=0;j<bv.length;j++) {
    const p=av[i],q=bv[j],r={x:av[(i+1)%av.length].x-p.x,y:av[(i+1)%av.length].y-p.y};
    const s={x:bv[(j+1)%bv.length].x-q.x,y:bv[(j+1)%bv.length].y-q.y};
    const cross=r.x*s.y-r.y*s.x;if(Math.abs(cross)<1e-12)continue;
    const t=((q.x-p.x)*s.y-(q.y-p.y)*s.x)/cross,u=((q.x-p.x)*r.y-(q.y-p.y)*r.x)/cross;
    if(t>=0&&t<=1&&u>=0&&u<=1){const point={x:p.x+t*r.x,y:p.y+t*r.y};return {a:point,b:point,distance:0};}
  }
  return best;
}
