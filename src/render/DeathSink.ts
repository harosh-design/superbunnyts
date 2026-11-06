import { Box3, Mesh, Object3D, Plane, Vector3 } from 'three';
import { MATCH_RULES } from '../world/Deathmatch';

/** Keep the final skinned pose, then lower it through the supporting ground. */
export class DeathSink {
  private readonly startY: number;
  private readonly depth: number;
  constructor(readonly root: Object3D, groundY: number) {
    root.updateMatrixWorld(true);
    this.startY = root.position.y;
    this.depth = Math.max(1.5, new Box3().setFromObject(root, true).max.y - groundY + 0.15);
    const ground = new Plane(new Vector3(0, 1, 0), -groundY);
    root.traverse(node => {
      if (node instanceof Mesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        material.clippingPlanes = [ground]; material.clipShadows = true; material.needsUpdate = true;
      }
    });
  }

  update(elapsed: number): void {
    const t = Math.max(0, Math.min(1, (elapsed - MATCH_RULES.deathHoldDuration) / MATCH_RULES.deathSinkDuration));
    this.root.position.y = this.startY - this.depth * t * t * (3 - 2 * t);
    this.root.visible = elapsed < MATCH_RULES.corpseDuration;
  }
}
