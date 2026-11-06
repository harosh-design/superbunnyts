import type { Actor } from '../../src/world/Actor';
import type { Surface } from '../../src/physics/Surfaces';

export function outline(surface: Surface) {
  if(surface.shape.kind!=='polygon')throw new Error('Expected a model-derived outline');
  return surface.shape.vertices.map(p=>surface.body.getWorldPoint(p));
}
export function region(actor: Actor, name: string): Surface {
  const surface=actor.environment.surfaces.all.find(s=>s.ownerId===actor.id&&s.fixtures.some(f=>(f.getUserData() as {region:string}).region===name));
  if(!surface)throw new Error(`Missing region: ${name}`);return surface;
}
export function translate(actor: Actor, dx:number,dy:number) {
  for(const b of actor.rig.bodies){const p=b.getPosition();b.setTransform({x:p.x+dx,y:p.y+dy},b.getAngle());b.setLinearVelocity({x:0,y:0});b.setAngularVelocity(0);}
  actor.rig.skin.sync();actor.current=actor.previous=actor.capture();
}
export function placeGrip(holder: Actor, victim: Actor, part='torso') {
  const hand=outline(holder.rig.skin.hands[0]).reduce((a,b)=>a.x*holder.rig.facing>b.x*holder.rig.facing?a:b);
  const point=outline(region(victim,part)).reduce((a,b)=>a.x*holder.rig.facing<b.x*holder.rig.facing?a:b);
  translate(victim,hand.x+.002*holder.rig.facing-point.x,hand.y-point.y);
}
export function placeStomp(attacker: Actor, victim: Actor, gap=.002) {
  const head=outline(region(victim,'Head')).reduce((a,b)=>a.y>b.y?a:b);
  const sole=outline(region(attacker,attacker.rig.skin.skeleton.legs[0].tip.name)).reduce((a,b)=>a.y<b.y?a:b);
  translate(attacker,head.x-sole.x,head.y+gap-sole.y);
}
