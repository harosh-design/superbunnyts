import * as THREE from 'three';
import { Circle, Polygon, type Vec2Value } from 'planck';
import type { PhysicsLab } from '../world/PhysicsLab';

export class DebugDraw {
  readonly root = new THREE.Group();
  private readonly lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#f5ed87', depthTest: false, transparent: true, opacity: 0.9 }));
  constructor() { this.root.add(this.lines); this.root.visible = false; this.lines.renderOrder = 10; }

  update(lab: PhysicsLab, alpha = 1): void {
    if (!this.root.visible) return;
    const vertices: number[] = [];
    const line = (a: Vec2Value, b: Vec2Value) => vertices.push(a.x, a.y, 0.6, b.x, b.y, 0.6);
    const cross = (p: Vec2Value, r: number) => { line({ x: p.x - r, y: p.y }, { x: p.x + r, y: p.y }); line({ x: p.x, y: p.y - r }, { x: p.x, y: p.y + r }); };
    const actorBodies=new Set(lab.actors.flatMap(a=>a.rig.bodies));
    for(const actor of lab.actors) {
      if(!actor.alive)continue;
      const p=actor.previous,c=actor.current;
      const lerp=(a:typeof p.core,b:typeof p.core)=>({x:a.x+(b.x-a.x)*alpha,y:a.y+(b.y-a.y)*alpha,angle:a.angle+(b.angle-a.angle)*alpha});
      const pose={core:lerp(p.core,c.core),arms:c.arms.map((b,i)=>lerp(p.arms[i],b)),legs:c.legs.map((b,i)=>lerp(p.legs[i],b)),objects:[]};
      for(const outline of actor.rig.skin.renderOutlines(pose,alpha))for(let i=0;i<outline.length;i++)line(outline[i],outline[(i+1)%outline.length]);
    }
    for (let body = lab.world.getBodyList(); body; body = body.getNext()) {
      if (!body.isActive()||actorBodies.has(body)) continue;
      for (let fixture = body.getFixtureList(); fixture; fixture = fixture.getNext()) {
        const shape = fixture.getShape();
        if (shape instanceof Circle) {
          const center = shape.getCenter(), radius = shape.getRadius();
          for (let i = 0; i < 32; i++) line(body.getWorldPoint({ x: center.x + radius * Math.cos(i * Math.PI / 16), y: center.y + radius * Math.sin(i * Math.PI / 16) }), body.getWorldPoint({ x: center.x + radius * Math.cos((i + 1) * Math.PI / 16), y: center.y + radius * Math.sin((i + 1) * Math.PI / 16) }));
        } else if (shape instanceof Polygon) {
          // Planck 1.5 exposes polygon vertices as its documented internal m_vertices.
          for (let i = 0; i < shape.m_count; i++) line(body.getWorldPoint(shape.m_vertices[i]), body.getWorldPoint(shape.m_vertices[(i + 1) % shape.m_count]));
        }
      }
      if (body.getType() === 'dynamic') cross(body.getWorldCenter(), 0.035);
    }
    for (let joint = lab.world.getJointList(); joint; joint = joint.getNext()) {
      if (!joint.getBodyA().isActive() || !joint.getBodyB().isActive()) continue;
      line(joint.getAnchorA(), joint.getAnchorB()); cross(joint.getAnchorA(), 0.025);
    }
    for (let contact = lab.world.getContactList(); contact; contact = contact.getNext()) {
      if (!contact.isTouching()) continue;
      const manifold = contact.getWorldManifold(null);
      if (manifold) for (let i = 0; i < manifold.pointCount; i++) {
        const p = manifold.points[i]; cross(p, 0.02);
        line(p, { x: p.x + manifold.normal.x * 0.12, y: p.y + manifold.normal.y * 0.12 });
      }
    }
    this.lines.geometry.dispose(); this.lines.geometry = new THREE.BufferGeometry();
    this.lines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  }
}
