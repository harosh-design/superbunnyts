import { Vector2 } from 'three';

/** A direct port of Unity's visual spring. It never feeds back into the physical rig. */
export class InertialSpring2D {
  readonly offset = new Vector2();
  readonly velocity = new Vector2();

  reset(): void { this.offset.set(0, 0); this.velocity.set(0, 0); }
  kick(velocity: Vector2): void { this.velocity.add(velocity); }

  step(dt: number, frequency: number, damping: number, limit: number, acceleration = new Vector2()): void {
    if (dt <= 0) return;
    const omega = 2 * Math.PI * Math.max(0.1, frequency);
    const steps = Math.ceil(dt / (1 / 240)), h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const force = acceleration.clone().addScaledVector(this.offset, -omega * omega)
        .addScaledVector(this.velocity, -2 * damping * omega);
      this.velocity.addScaledVector(force, h);
      this.offset.addScaledVector(this.velocity, h);
      if (this.offset.lengthSq() > limit * limit) {
        const outward = this.offset.clone().normalize();
        this.offset.copy(outward).multiplyScalar(limit);
        this.velocity.addScaledVector(outward, -Math.max(0, this.velocity.dot(outward)));
      }
    }
  }
}
