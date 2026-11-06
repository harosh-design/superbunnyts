import { RevoluteJoint, type World } from 'planck';
import { DEG2RAD, tuning } from '../config/bunnyTuning';
import { closestPair, type Surface, type Surfaces } from '../physics/Surfaces';
import type { BunnyRig } from './BunnyRig';

export class BunnyGrab {
  private readonly joints: (RevoluteJoint | null)[] = [null, null];
  readonly held: (Surface | null)[] = [null, null];
  grabbedThisStep = 0;
  reaching = false;

  constructor(private readonly world: World, private readonly rig: BunnyRig, private readonly surfaces: Surfaces) {}
  holding(i: number): boolean { return this.joints[i] !== null; }

  step(want: boolean): void {
    this.reaching = want;
    this.grabbedThisStep = 0;
    for (let i = 0; i < 2; i++) {
      if (!want) { this.release(i); continue; }
      if (this.holding(i)) {
        const joint=this.joints[i]!,surface=this.held[i]!;
        const anchor=joint.getAnchorB(),point=surface.closest(anchor);
        this.rig.skin.gripDepth(i,surface,joint.getAnchorA(),point);
        if(Math.hypot(point.x-anchor.x,point.y-anchor.y)>.001)joint._reset({localAnchorB:surface.body.getLocalPoint(point)});
        continue;
      }
      const handSurface = this.rig.skin.hands[i];
      const hand = this.rig.arms[i].getWorldPoint(this.rig.handLocal);
      const radius = handSurface.shape.kind === 'polygon' ? Math.max(...handSurface.shape.vertices.map(v => Math.hypot(v.x-this.rig.handLocal.x,v.y-this.rig.handLocal.y))) : tuning.arm.handRadius;
      const candidates = this.surfaces.near(hand, radius + tuning.grab.radius, this.rig.id)
        .map(hit => ({...hit, pair:closestPair(handSurface,hit.surface)}))
        .filter(hit => hit.pair.distance <= tuning.grab.radius)
        .sort((a,b) => a.pair.distance-b.pair.distance || a.surface.id-b.surface.id);
      const hit = candidates[0];
      if (!hit) continue;
      const contact=hit.pair.a, {x,y}=hit.pair.b;
      const joint = new RevoluteJoint({
        bodyA: this.rig.arms[i], bodyB: hit.surface.body,
        localAnchorA: this.rig.arms[i].getLocalPoint(contact),
        localAnchorB: hit.surface.body.getLocalPoint({ x, y }),
        collideConnected: true, enableLimit: false, enableMotor: false
      });
      this.world.createJoint(joint);
      this.joints[i] = joint;
      this.held[i] = hit.surface;
      this.rig.skin.gripDepth(i,hit.surface,contact,{x,y});
      this.rig.skin.previousHandDepths[i]=this.rig.skin.handDepths[i];
      this.grabbedThisStep++;
    }
  }

  /** A bounded position-constraint pass for contact grips. Corrects physical
   * bodies, never the rendered wrist, when simultaneous skin contacts leave a
   * small residual in Planck's coupled shoulder/grip solve. Velocities and total
   * centre of mass are preserved, just as in a solver position correction. */
  projectContacts(): Set<import('planck').Body> {
    const moved=new Set<import('planck').Body>();
    for(let i=0;i<2;i++) {
      const joint=this.joints[i],target=this.held[i];if(!joint||!target)continue;
      const hand=this.rig.skin.hands[i],a=hand.closest(joint.getAnchorA(),true),b=target.closest(joint.getAnchorB(),true);
      joint._reset({localAnchorA:hand.body.getLocalPoint(a),localAnchorB:target.body.getLocalPoint(b)});
      const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);
      if(d>.0001&&d<.04) {
        const invA=1/hand.body.getMass(),invB=target.body.getType()==='dynamic'?1/target.body.getMass():0;
        const sum=invA+invB;
        for(const [body,weight] of [[hand.body,invA/sum],[target.body,-invB/sum]] as const) {
          if(!weight)continue;
          const p=body.getPosition();body.setPosition({x:p.x+dx*weight,y:p.y+dy*weight});moved.add(body);
        }
      }
      this.rig.skin.gripDepth(i,target,joint.getAnchorA(),joint.getAnchorB());
      moved.add(hand.body);
    }
    return moved;
  }

  reachAngle(i: number): number {
    const arm = this.rig.arms[i], hand = arm.getWorldPoint(this.rig.handLocal), shoulder = arm.getPosition();
    const vector = { x: hand.x - shoulder.x, y: hand.y - shoulder.y };
    const shape=this.rig.skin.hands[i].shape;
    const reach=shape.kind==='polygon'?Math.max(...shape.vertices.map(v=>Math.hypot(v.x,v.y)))+tuning.grab.radius:Math.abs(this.rig.handLocal.x)+tuning.arm.handRadius;
    for (const hit of this.surfaces.near(shoulder, reach, this.rig.id)) {
      if (hit.distance < 1e-6) continue;
      const to = { x: hit.point.x - shoulder.x, y: hit.point.y - shoulder.y };
      const signed = Math.atan2(vector.x * to.y - vector.y * to.x, vector.x * to.x + vector.y * to.y);
      const target = this.rig.armJoints[i].getJointAngle() - signed;
      if (Math.abs(target) > (tuning.arm.limitDeg + 15) * DEG2RAD) continue;
      return Math.max(-tuning.arm.limitDeg * DEG2RAD, Math.min(tuning.arm.limitDeg * DEG2RAD, target));
    }
    return -tuning.grab.reachAngle * DEG2RAD * this.rig.facing;
  }

  release(i: number): void {
    const joint = this.joints[i];
    if (joint) this.world.destroyJoint(joint);
    this.joints[i] = null;
    this.held[i] = null;
    this.rig.skin.releaseDepth(i);
  }
  releaseAll(): void { this.release(0); this.release(1); this.reaching = false; }
}
