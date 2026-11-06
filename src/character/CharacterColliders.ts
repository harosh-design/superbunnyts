import { Polygon, type Body, type Fixture, type MassData } from 'planck';
import type { BunnyRig } from '../bunny/BunnyRig';
import type { BunnyPose } from '../world/PhysicsLab';
import type { ModelKind } from '../world/Actor';
import { bunnyFilter } from '../physics/CollisionFilters';
import { convexHull, partitionHull } from '../physics/ConvexHull';
import { Surface, type Surfaces } from '../physics/Surfaces';
import { CharacterSkeleton } from './CharacterSkeleton';
import type { Vec2 } from '../config/bunnyTuning';

interface Region { name: string; body: Body; surface: Surface; sensor: boolean }

/** Collision outlines of the very same skin pose rendered by CharacterVisual. */
export class CharacterColliders {
  readonly skeleton: CharacterSkeleton;
  readonly hands: Surface[] = [];
  readonly handDepths: number[];
  readonly previousHandDepths: number[];
  private readonly regions: Region[] = [];
  private readonly mass = new Map<Body, MassData>();

  constructor(private readonly rig: BunnyRig, model: ModelKind, private readonly surfaces?: Surfaces) {
    this.skeleton = new CharacterSkeleton(model, rig.facing);
    this.handDepths=[...this.skeleton.defaultHandDepths];this.previousHandDepths=[...this.handDepths];
    for(const body of rig.bodies) {
      const mass = { mass:0, center:{x:0,y:0}, I:0 }; body.getMassData(mass); this.mass.set(body, mass);
      for(let f=body.getFixtureList();f;) { const next=f.getNext(); body.destroyFixture(f); f=next; }
    }
    surfaces?.removeOwner(rig.id);
    const pose = this.capture(); this.skeleton.solve(pose,rig.handLocal);
    const armSide = this.skeleton.arms.map(l=>l.tip.name.slice(-1)), legSide = this.skeleton.legs.map(l=>l.tip.name.slice(-1));
    // A torso hull covers Root/Spine/Belly together; head and ears keep separate roles.
    const names = ['torso', ...this.skeleton.data.regions.map(r=>r.name).filter(n=>!['Root','Spine','Belly'].includes(n))];
    for(const name of names) {
      let body=rig.core;
      if(/Arm|Forearm|Mitten/.test(name)) body=rig.arms[armSide.indexOf(name.slice(-1))];
      if(/Thigh|Shin|Foot/.test(name)) body=rig.legs[legSide.indexOf(name.slice(-1))];
      const sensor=false;
      const shape = { kind:'polygon' as const, ...this.outline(name,body) };
      const fixtures=this.fixtures(body,shape.vertices,name,sensor);
      const surface=surfaces?.register(body,shape,fixtures,rig.id,sensor) ?? new Surface(0,body,shape,rig.id,sensor);
      if(!surfaces) surface.fixtures.push(...fixtures);
      this.regions.push({name,body,surface,sensor});
      if(name.startsWith('Mitten'))this.hands[rig.arms.indexOf(body)]=surface;
    }
    this.restoreMass();
  }

  /** Called at fixed-step boundaries, never from a render frame. */
  sync(pose = this.capture()): void {
    this.skeleton.solve(pose,this.rig.handLocal,this.handDepths);
    for(const r of this.regions) {
      const {vertices,depths}=this.outline(r.name,r.body), shape=r.surface.shape;
      if(shape.kind!=='polygon')continue;
      shape.depths=depths;
      if(vertices.length===shape.vertices.length && vertices.every((v,i)=>Math.hypot(v.x-shape.vertices[i].x,v.y-shape.vertices[i].y)<.0002))continue;
      const parts=partitionHull(vertices);
      if(parts.length===r.surface.fixtures.length) {
        parts.forEach((points,i)=>{
          const fixture=r.surface.fixtures[i],polygon=fixture.getShape() as Polygon;
          // Planck 1.5's fixture reset refreshes broadphase proxies and preserves
          // the fixture identity/contact cache when the skin changes shape.
          (polygon as Polygon & { _set(points: Vec2[]): void })._set(points);fixture._reset();polygon.m_radius=0;
        });
      } else {
        for(const f of [...r.surface.fixtures]) r.body.destroyFixture(f);
        const fixtures=this.fixtures(r.body,vertices,r.name,r.sensor);
        if(this.surfaces)this.surfaces.replaceFixtures(r.surface,fixtures);
        else r.surface.fixtures.splice(0,r.surface.fixtures.length,...fixtures);
      }
      shape.vertices=vertices;
    }
    this.restoreMass();
  }

  renderOutlines(pose:BunnyPose,alpha:number):Vec2[][] {
    this.skeleton.solve(pose,this.rig.handLocal,this.handDepths.map((d,i)=>this.previousHandDepths[i]+(d-this.previousHandDepths[i])*alpha));
    return this.regions.map(r=>convexHull((r.name==='torso'?['Root','Spine','Belly']:[r.name]).flatMap(n=>this.skeleton.vertices(n))));
  }

  capturePrevious():void { this.previousHandDepths.splice(0,2,...this.handDepths); }
  gripDepth(i:number, surface:Surface, handPoint:Vec2, targetPoint:Vec2):void {
    this.handDepths[i]+=surface.depthAt(targetPoint)-this.hands[i].depthAt(handPoint);
    this.handDepths[i]=Math.max(-.6,Math.min(.6,this.handDepths[i]));
  }
  releaseDepth(i:number):void { this.handDepths[i]=this.skeleton.defaultHandDepths[i]; }
  private outline(name: string, body: Body): {vertices:Vec2[];depths:number[]} {
    const points=(name==='torso'?['Root','Spine','Belly']:[name]).flatMap(n=>this.skeleton.vertices(n));
    const local=points.map(p=>({...body.getLocalPoint(p),z:p.z}));
    const vertices=convexHull(local);
    const depths=vertices.map(v=>{let best=local[0],distance=Infinity;for(const p of local){const d=(p.x-v.x)**2+(p.y-v.y)**2;if(d<distance){distance=d;best=p;}}return best.z;});
    return {vertices,depths};
  }

  private fixtures(body: Body, vertices: Vec2[], name: string, sensor: boolean): Fixture[] {
    return partitionHull(vertices).map(points=>{
      const polygon=new Polygon(points);polygon.m_radius=0;
      return body.createFixture(polygon,{...bunnyFilter(this.rig.id), density:0, friction:name.startsWith('Foot') ? .9 : .4, restitution:0, isSensor:sensor,
        userData:{role:name==='Head'?'head':name.startsWith('Ear')?'ear':name==='torso'?'torso':name, region:name}});
    });
  }
  private restoreMass():void { for(const [body,mass] of this.mass) body.setMassData(mass); }
  private capture():BunnyPose {
    const pose=(b:Body)=>({...b.getPosition(),angle:b.getAngle()});
    return {core:pose(this.rig.core),arms:this.rig.arms.map(pose),legs:this.rig.legs.map(pose),objects:[]};
  }
}
