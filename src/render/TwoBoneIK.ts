import { Object3D, Quaternion, Vector3 } from 'three';

export interface Limb { upper: Object3D; lower: Object3D; tip: Object3D }

export function setWorldRotation(bone: Object3D, rotation: Quaternion): void {
  const parentRotation = bone.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion();
  bone.quaternion.copy(parentRotation.invert().multiply(rotation));
  bone.updateWorldMatrix(false, true);
}

export function rotateWorld(bone: Object3D, rotation: Quaternion): void {
  setWorldRotation(bone, rotation.clone().multiply(bone.getWorldQuaternion(new Quaternion())));
}

/** Same two-bone construction as BunnyVisual.TwoBone, using world-space directions. */
export function twoBone(limb: Limb, target: Vector3, bend: Vector3): void {
  const root = limb.upper.getWorldPosition(new Vector3());
  const mid0 = limb.lower.getWorldPosition(new Vector3());
  const tip0 = limb.tip.getWorldPosition(new Vector3());
  const a = root.distanceTo(mid0), b = mid0.distanceTo(tip0);
  const toTarget = target.clone().sub(root);
  const d = Math.max(Math.abs(a - b) + 0.001, Math.min(a + b - 0.001, toTarget.length()));
  if (toTarget.lengthSq() < 1e-10 || a < 1e-6 || b < 1e-6) return;
  const angle = Math.acos(Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d))));
  const dir = toTarget.normalize();
  const across = bend.clone().addScaledVector(dir, -bend.dot(dir)).normalize();
  if (across.lengthSq() < 1e-6) across.crossVectors(dir, new Vector3(0, 0, 1)).normalize();
  const mid = root.clone().addScaledVector(dir, Math.cos(angle) * a).addScaledVector(across, Math.sin(angle) * a);
  aim(limb.upper, mid0.sub(root), mid.sub(root));
  const elbow = limb.lower.getWorldPosition(new Vector3());
  aim(limb.lower, limb.tip.getWorldPosition(new Vector3()).sub(elbow), target.clone().sub(elbow));
}

function aim(bone: Object3D, from: Vector3, to: Vector3): void {
  if (from.lengthSq() < 1e-8 || to.lengthSq() < 1e-8) return;
  rotateWorld(bone, new Quaternion().setFromUnitVectors(from.normalize(), to.normalize()));
}
