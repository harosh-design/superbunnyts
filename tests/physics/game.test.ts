import { describe, expect, it } from 'vitest';
import { PhysicsLab } from '../../src/world/PhysicsLab';
import { emptyInputFrame } from '../../src/input/InputFrame';
import { newReplay, readReplay, runReplay } from '../../src/debug/Replay';
import { springLift } from '../../src/world/SpringPad';
import reference from '../../reference/unity-runtime/current.json';
import { SCENES } from '../../src/world/Environment';

const input = (extra = {}) => ({ ...emptyInputFrame(), ...extra });
function advance(lab: PhysicsLab, ticks: number, controls = input()) { for (let i = 0; i < ticks; i++) expect(lab.step(controls)).toBeNull(); }

describe('ported single-player physics', () => {
 it('builds the complete dynamic lab with clean joint counts', () => {
  const lab = new PhysicsLab(); expect(lab.world.getBodyCount()).toBe(11); expect(lab.world.getJointCount()).toBe(9);
  expect(lab.rig.bodies.reduce((m,b)=>m+b.getMass(),0)).toBeCloseTo(9.2, 8);
  advance(lab, 500); expect(lab.grounded).toBe(true);
  expect(lab.environment.bag!.getPosition().y).toBeCloseTo(1.325, 1);
 });
 it('stands without pogo and consumes one jump edge', () => {
  const lab = new PhysicsLab('flat'); advance(lab,75);const start=lab.current.core.y;
  lab.step(input({jumpPressed:true,jumpHeld:true}));let peak=start;
  for(let i=0;i<150;i++){lab.step(input({jumpHeld:true}));peak=Math.max(peak,lab.current.core.y);}
  expect(peak-start).toBeGreaterThan(1);expect(peak-start).toBeLessThan(1.4);expect(lab.grounded).toBe(true);
  const y=lab.current.core.y;advance(lab,500);expect(Math.abs(lab.current.core.y-y)).toBeLessThan(.02);
 });
 it.each([-1,1])('rolls in direction %s', direction => {const lab=new PhysicsLab('flat');advance(lab,30);const x=lab.current.core.x;advance(lab,100,input({roll:direction}));expect((lab.current.core.x-x)*direction).toBeGreaterThan(1);});
 it('grabs and releases a dynamic bag with independent hinges',()=>{
  const lab=new PhysicsLab('lab',{x:.4,y:.64});const initial=lab.environment.bag!.getPosition().y;
  lab.step(input({grabHeld:true}));expect(lab.grab.holding(0)).toBe(true);expect(lab.grab.holding(1)).toBe(true);expect(lab.world.getJointCount()).toBe(11);
  advance(lab,40,input({grabHeld:true}));expect(Math.abs(lab.environment.bag!.getPosition().y-initial)).toBeGreaterThan(.001);
  lab.step(input());expect(lab.world.getJointCount()).toBe(9);expect(lab.grab.holding(0)).toBe(false);
 });
 it('hangs from the actual articulated vine',()=>{const lab=new PhysicsLab('vine');advance(lab,75,input({grabHeld:true}));expect(lab.grab.held.some(s=>s?.body.getType()==='dynamic')).toBe(true);expect(lab.current.core.y).toBeGreaterThan(1);expect(lab.grounded).toBe(false);});
 it('keeps a floor grip above the broad surface',()=>{const lab=new PhysicsLab('flat',{x:0,y:0});advance(lab,25);advance(lab,15,input({roll:1}));advance(lab,75);advance(lab,50,input({grabHeld:true}));for(let i=0;i<2;i++){expect(lab.grab.holding(i)).toBe(true);expect(lab.rig.arms[i].getWorldPoint(lab.rig.handLocal).y).toBeGreaterThan(.048);}});
 it('bounces repeatedly and sends the inclined pad left',()=>{
  const lab=new PhysicsLab('spring',{x:0,y:.8});let peak=0,launches=0;
  for(let i=0;i<250;i++){lab.step(input());if(lab.events.spring)launches++;peak=Math.max(peak,lab.current.core.y);}
  expect(launches).toBeGreaterThanOrEqual(2);expect(peak).toBeGreaterThan(3.5);expect(peak).toBeLessThan(5.5);
  const tilted=new PhysicsLab('spring-tilt',{x:0,y:.8});advance(tilted,60);expect(tilted.current.core.x).toBeLessThan(-1.5);
  expect(springLift(0)).toBeCloseTo(.06);expect(springLift(1)).toBeCloseTo(.06);
 });
 it('replays the same tick inputs without drift',()=>{const r=newReplay('flat');for(let i=0;i<130;i++)r.frames.push([input({roll:i>40?1:0,jumpPressed:i===30})]);const a=runReplay(r),b=runReplay(readReplay(JSON.parse(JSON.stringify(r))));expect(a.current).toEqual(b.current);expect(()=>readReplay({...r,dt:.01})).toThrow();});
});

describe('complete deathmatch',()=>{
 it('loads both source maps and counts down with gated inputs',()=>{for(const scene of ['dm-flat','dm-meadow'] as const){const lab=new PhysicsLab(scene,undefined,{players:4});expect(lab.players).toHaveLength(4);expect(lab.actors.map(a=>a.rig.facing)).toEqual(lab.environment.spawns.map(p=>p.x>0?-1:1));for(let i=0;i<150;i++)lab.step(Array.from({length:4},()=>input({jumpPressed:true,roll:1})));expect(lab.match!.phase).toBe('countdown');lab.step(input());expect(lab.match!.phase).toBe('playing');}});
 it('keeps player rigs collidable while suppressing self collisions',()=>{const lab=new PhysicsLab('dm-flat');expect(lab.players[0].actor.rig.core.getFixtureList()!.getFilterGroupIndex()).not.toBe(lab.players[1].actor.rig.core.getFixtureList()!.getFilterGroupIndex());});
 it('finishes dissolving before respawning far from rivals',()=>{
  const lab=new PhysicsLab('dm-flat',undefined,{lives:2});advance(lab,151);const dead=lab.players[0].actor;
  lab.eliminate(0,'kick',1);expect(lab.players[0].lives).toBe(1);expect(lab.players[1].kills).toBe(1);expect(dead.alive).toBe(false);expect(dead.rig.legJoints.every(j=>!j.isMotorEnabled())).toBe(true);
  expect(dead.rig.bodies.every(b=>!b.isActive())).toBe(true);
  expect(lab.environment.surfaces.all.some(s=>s.ownerId===dead.id)).toBe(false);
  advance(lab,20);expect(dead.removed).toBe(false);expect(lab.players[0].actor).toBe(dead);
  advance(lab,4);expect(dead.removed).toBe(true);expect(lab.actors).toHaveLength(1);expect(lab.players[0].actor).toBe(dead);
  advance(lab,7);expect(lab.players[0].actor.id).not.toBe(dead.id);expect(lab.actors).toHaveLength(2);
  expect(lab.players[0].actor.health).toBe(100);expect(lab.players[0].actor.current.core.x).toBeLessThan(0);
 });
 it('reports a winner, gates controls and waits before a rematch',()=>{const lab=new PhysicsLab('dm-flat',undefined,{lives:1});advance(lab,151);lab.eliminate(0);expect(lab.match!.phase).toBe('results');expect(lab.match!.winner).toBe(1);lab.step(input({jumpPressed:true}));expect(lab.match!.restartRequested).toBe(false);advance(lab,75);lab.step(input({jumpPressed:true}));expect(lab.match!.restartRequested).toBe(true);});
 it('uses exported Meadow hazards and two spring assemblies',()=>{const lab=new PhysicsLab('dm-meadow');expect(lab.environment.springs).toHaveLength(2);let hazards=0;for(let b=lab.world.getBodyList();b;b=b.getNext())if(b.getUserData().hazard)hazards++;expect(hazards).toBe(3);expect(Object.keys(SCENES)).toContain('dm-meadow');});
});

function moveActor(lab: PhysicsLab, player: number, x: number, y: number, angle = 0) {
 const actor=lab.players[player].actor, center=actor.rig.core.getPosition().clone(), c=Math.cos(angle),s=Math.sin(angle);
 for(const body of actor.rig.bodies){const p=body.getPosition(),dx=p.x-center.x,dy=p.y-center.y;body.setTransform({x:x+dx*c-dy*s,y:y+dx*s+dy*c},body.getAngle()+angle);body.setLinearVelocity({x:0,y:0});body.setAngularVelocity(0);}
}

describe('real combat contacts',()=>{
 it('kills on Meadow spikes without leaving a collidable corpse',()=>{
  const lab=new PhysicsLab('dm-meadow');const base=lab.world.getJointCount();moveActor(lab,0,0,-3.1);
  for(let i=0;i<4&&lab.players[0].actor.alive;i++)lab.step(input());
  expect(lab.players[0].actor.cause).toBe('hazard');expect(lab.players[0].lives).toBe(9);expect(lab.world.getJointCount()).toBe(base);
  expect(lab.players[0].actor.rig.bodies.every(b=>!b.isActive())).toBe(true);
 });
 it('releases the opponent grip immediately and prevents grabbing a dissolving body',()=>{
  const lab=new PhysicsLab('dm-flat',undefined,{lives:2});advance(lab,151);
  moveActor(lab,0,0,3);moveActor(lab,1,.63,3.24);
  lab.step([input({grabHeld:true}),input()]);
  const holder=lab.players[0].actor,victim=lab.players[1].actor;
  expect(holder.grab.held.some(s=>s?.ownerId===victim.id)).toBe(true);
  lab.eliminate(1,'head',0);
  expect(holder.grab.held.every(s=>s===null)).toBe(true);
  advance(lab,5,input({grabHeld:true}));expect(holder.grab.held.every(s=>s===null)).toBe(true);
 });
 it('cleans up the last lost life during results without spawning a replacement',()=>{
  const lab=new PhysicsLab('dm-flat',undefined,{lives:1});advance(lab,151);
  const dead=lab.players[0].actor;lab.eliminate(0,'head',1);advance(lab,35);
  expect(lab.match!.phase).toBe('results');expect(dead.removed).toBe(true);
  expect(lab.players[0].actor).toBe(dead);expect(lab.players[0].lives).toBe(0);expect(lab.actors).toHaveLength(1);
 });
 it('keeps health on a fast head-first terrain landing',()=>{
  const lab=new PhysicsLab('dm-flat');advance(lab,151);moveActor(lab,0,-2,3,Math.PI);
  for(let i=0;i<100&&lab.players[0].actor.alive;i++)lab.step(input());
  expect(lab.players[0].actor.alive).toBe(true);expect(lab.players[0].actor.health).toBe(100);expect(lab.players[0].lives).toBe(10);
 });
 it('damages a head push-off without an automatic kick kill',()=>{
  const lab=new PhysicsLab('dm-flat');advance(lab,160);
  const victim=lab.players[1].actor, p=victim.rig.core.getPosition();
  // The sole is 0.39 m below the core; place it just above the opponent's head.
  const head=victim.rig.core.getWorldPoint({x:.02*victim.rig.facing,y:.34});
  moveActor(lab,0,head.x-.1,head.y+.155+.02+.39);
  advance(lab,15);expect(lab.players[0].actor.motor.grounded(lab.time)).toBe(true);
  lab.step([input({jumpPressed:true}),input()]);advance(lab,8);
  expect(victim.health).toBeGreaterThan(0);expect(victim.health).toBeLessThan(100);expect(victim.alive).toBe(true);
  expect(lab.players[1].lives).toBe(10);expect(lab.players[0].kills).toBe(0);expect(lab.players[0].actor.alive).toBe(true);
 });
 it('replays multiplayer input with matching lives, respawns and body poses',()=>{
  const replay=newReplay('dm-flat',{players:2,lives:2});
  for(let i=0;i<650;i++)replay.frames.push([input({roll:i>155?1:0,jumpPressed:i===170}),input()]);
  const a=runReplay(replay),b=runReplay(readReplay(JSON.parse(JSON.stringify(replay))));
  expect(a.players.map(p=>[p.lives,p.kills,p.actor.health,p.actor.current])).toEqual(b.players.map(p=>[p.lives,p.kills,p.actor.health,p.actor.current]));
  expect(a.world.getBodyCount()).toBe(b.world.getBodyCount());
 });
});

it('keeps both four-player maps finite and cleans up corpses during sustained play',()=>{
 for(const scene of ['dm-flat','dm-meadow'] as const){
  const lab=new PhysicsLab(scene,undefined,{players:4});let seed=17;
  const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<5000;i++){
   const frames=Array.from({length:4},()=>input({roll:random()<.3?-1:random()<.5?1:0,jumpPressed:random()<.08,grabHeld:random()<.6}));
   expect(lab.step(frames)).toBeNull();expect(lab.world.getBodyCount()).toBeLessThan(120);
  }
  expect(lab.environment.surfaces.all.filter(s=>s.ownerId!==undefined).every(s=>lab.actors.some(a=>a.id===s.ownerId))).toBe(true);
 }
});

it('matches measured Unity mass properties and resting height',()=>{
 const lab=new PhysicsLab('flat'), bodies=[lab.rig.core,lab.rig.legs[0],lab.rig.arms[0],lab.rig.legs[1],lab.rig.arms[1]];
 bodies.forEach((body,i)=>{const measured=reference.scenarios[0].initial[i],c=body.getLocalCenter();expect(body.getMass()).toBeCloseTo(measured.mass,6);expect(c.x).toBeCloseTo(measured.cx,6);expect(c.y).toBeCloseTo(measured.cy,6);expect(body.getInertia()-body.getMass()*(c.x*c.x+c.y*c.y)).toBeCloseTo(measured.inertia,7);});
 advance(lab,200);expect(Math.abs(lab.current.core.y-reference.scenarios[0].ticks[149].core.y)).toBeLessThan(.001);
});
