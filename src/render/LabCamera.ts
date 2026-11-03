import { PerspectiveCamera } from 'three';
import type { PhysicsLab } from '../world/PhysicsLab';

export class LabCamera {
  private x = 0.5; private y = 1.8; private height = 5.6;
  private vx = 0; private vy = 0; private vh = 0;
  fixed = false;

  update(camera: PerspectiveCamera, lab: PhysicsLab, dt: number, snap: boolean): void {
    const living = lab.actors.filter(a => a.alive);
    const p = living[0]?.rig.core.getPosition() ?? { x: 0, y: 1 };
    const competitive = lab.scene.startsWith('dm-');
    let minX = p.x, maxX = p.x, minY = p.y - 0.5, maxY = p.y + 0.7;
    for (const actor of living.slice(1)) {
      const p = actor.rig.core.getPosition(); minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y - 0.5); maxY = Math.max(maxY, p.y + 0.7);
    }
    const bag = lab.environment.bag;
    if (bag) {
      const b = bag.getPosition(), a = bag.getAngle();
      const halfX = 0.35 + Math.abs(Math.sin(a)) * 0.325, halfY = 0.35 + Math.abs(Math.cos(a)) * 0.325;
      minX = Math.min(minX, b.x - halfX, 1.1); maxX = Math.max(maxX, b.x + halfX, 1.1);
      minY = Math.min(minY, b.y - halfY); maxY = Math.max(maxY, b.y + halfY, 3.6);
    } else if (lab.scene === 'vine') maxY = Math.max(maxY, 3.2);
    const required = Math.max(maxY - minY, (maxX - minX) / camera.aspect) + (competitive ? 3 : 1.3);
    // The source's 13 m cap hides the outer two spawns in a four-player match.
    // Expand only as needed to keep all selected players visible, within arena bounds.
    const maximum = competitive ? Math.max(13, lab.players.length > 2 ? required : 0) : 10;
    let wanted = Math.max(competitive ? 4.4 : 5.6, Math.min(maximum, required));
    const bounds = lab.environment.cameraBounds;
    wanted = Math.min(wanted, bounds.height, bounds.width / camera.aspect);
    const x = Math.max(bounds.x + wanted * camera.aspect / 2, Math.min(bounds.x + bounds.width - wanted * camera.aspect / 2, (minX + maxX) / 2));
    const y = Math.max(bounds.y + wanted / 2, Math.min(bounds.y + bounds.height - wanted / 2, (minY + maxY) / 2 + wanted * (competitive ? 0.1 : -0.04)));
    if (snap) { this.x = x; this.y = y; this.height = wanted; this.vx = this.vy = this.vh = 0; }
    if (this.fixed) { this.x = 0; this.y = 1.65; this.height = 5.6; this.vx = this.vy = this.vh = 0; }
    else {
      [this.x, this.vx] = smoothDamp(this.x, x, this.vx, dt);
      [this.y, this.vy] = smoothDamp(this.y, y, this.vy, dt);
      [this.height, this.vh] = smoothDamp(this.height, wanted, this.vh, dt);
    }
    camera.position.set(this.x, this.y, this.height / (2 * Math.tan(Math.PI / 12)));
    camera.lookAt(this.x, this.y, 0);
  }
}

function smoothDamp(current: number, target: number, velocity: number, dt: number): [number, number] {
  const omega = 2 / 0.35, x = omega * dt, exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target, temp = (velocity + omega * change) * dt;
  const result = target + (change + temp) * exp;
  return (target - current > 0) === (result > target) ? [target, 0] : [result, (velocity - omega * temp) * exp];
}
