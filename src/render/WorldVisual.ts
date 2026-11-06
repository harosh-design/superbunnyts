import * as THREE from 'three';
import type { PhysicsLab, Pose } from '../world/PhysicsLab';

interface XYZ { x: number; y: number; z: number }
export interface Scenery {
  objects: { name: string; mesh: string; position: XYZ; scale: XYZ; rotation: XYZ & { w: number }; color: { r: number; g: number; b: number; a: number } }[];
}

export class WorldVisual {
  readonly root = new THREE.Group();
  private readonly objects: THREE.Group[] = [];
  private coils: { mesh: THREE.Mesh; spring: NonNullable<PhysicsLab['environment']['spring']> }[] = [];
  constructor(readonly lab: PhysicsLab, scenery: Scenery, sky: THREE.Texture) {
    const primitives: Record<string, THREE.BufferGeometry> = {
      Cube: new THREE.BoxGeometry(1, 1, 1), Sphere: new THREE.SphereGeometry(0.5, 20, 14), Quad: new THREE.PlaneGeometry(1, 1), Capsule: new THREE.CapsuleGeometry(0.5, 1, 8, 16), Cylinder: new THREE.CylinderGeometry(0.5, 0.5, 2, 20)
    };
    for (const desc of scenery.objects) {
      if (lab.scene !== 'lab' && ['Bag support', 'Overhead beam', 'Support foot'].includes(desc.name)) continue;
      const geometry = primitives[desc.mesh];
      if (!geometry) throw new Error(`Unsupported Unity scenery mesh: ${desc.mesh}`);
      const color = new THREE.Color().setRGB(desc.color.r, desc.color.g, desc.color.b, THREE.SRGBColorSpace);
      const material = desc.name === 'Sky' ? new THREE.MeshBasicMaterial({ map: sky })
        : new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = desc.name;
      mesh.position.set(desc.position.x, desc.position.y, -desc.position.z);
      mesh.quaternion.set(-desc.rotation.x, -desc.rotation.y, desc.rotation.z, desc.rotation.w);
      mesh.scale.set(desc.scale.x, desc.scale.y, desc.scale.z);
      mesh.castShadow = !['Sky', 'Meadow', 'Hill', 'Puff'].includes(desc.name);
      mesh.receiveShadow = desc.name !== 'Sky';
      this.root.add(mesh);
    }
    lab.environment.objects.forEach(object => {
      const group = new THREE.Group();
      this.objects.push(group); this.root.add(group);
      const shape = object.surface.shape;
      if (object.style === 'floor' || shape.kind === 'circle' || shape.kind === 'polygon') return;
      const width = shape.width, height = shape.height;
      const colors = { floor: '#73ad46', block: '#8b9c91', bag: '#b81f1a', chain: '#b8c4cc', vine: '#4d8c40', crate: '#bd8150', pad: '#e61a1f' };
      const drawnWidth = object.style === 'chain' ? 0.07 : width;
      const geometry = object.style === 'pad' ? new THREE.CylinderGeometry(width / 2, width / 2, height, 24)
        : shape.kind === 'capsule' ? new THREE.CapsuleGeometry(drawnWidth / 2, height - drawnWidth, 8, 16)
        : new THREE.BoxGeometry(width, height, width);
      group.add(mesh(geometry, colors[object.style]));
      if (object.style === 'bag') {
        for (const y of [-0.36, 0.36]) {
          const band = mesh(new THREE.CylinderGeometry(0.3575, 0.3575, 0.13, 24), '#2e3d47');
          band.position.y = y; group.add(band);
        }
        for (let i = 0; i < 5; i++) {
          const stitch = mesh(new THREE.BoxGeometry(0.09, 0.018, 0.018), '#b8c4cc');
          stitch.position.set(0, -0.16 + i * 0.08, 0.35); group.add(stitch);
        }
      }
    });
    for (const spring of lab.environment.springs) {
      const base = new THREE.Group(); base.position.set(spring.origin.x, spring.origin.y, 0); base.rotation.z = spring.angle;
      const plate = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 24), '#5c5c66');
      plate.position.y = 0.03; base.add(plate);
      const points: THREE.Vector3[] = [];
      for (let i = 0; i <= 72; i++) {
        const t = i / 72, a = t * 6 * Math.PI;
        points.push(new THREE.Vector3(Math.cos(a) * 0.224, 0.028 + t * (0.42 - 0.056), Math.sin(a) * 0.224));
      }
      const coil = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 72, 0.028, 8, false), '#ededed');
      this.coils.push({ mesh: coil, spring }); base.add(coil); this.root.add(base);
    }
  }

  update(poses: Pose[]): void {
    poses.forEach((pose, i) => { this.objects[i].position.set(pose.x, pose.y, 0); this.objects[i].rotation.z = pose.angle; });
    for (const { mesh: coil, spring } of this.coils) {
      const index = this.lab.environment.objects.findIndex(o => o.body === spring.pad), p = poses[index];
      const lift = (p.x - spring.origin.x) * -Math.sin(spring.angle) + (p.y - spring.origin.y) * Math.cos(spring.angle) - 0.07;
      coil.scale.y = Math.max(0.01, lift) / 0.42;
    }
  }
}

function mesh(geometry: THREE.BufferGeometry, color: string): THREE.Mesh {
  const object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.75 }));
  object.castShadow = true; object.receiveShadow = true;
  return object;
}

export function disposeObjects(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  root.traverse(node => {
    if (node instanceof THREE.Mesh || node instanceof THREE.LineSegments || node instanceof THREE.Points) {
      geometries.add(node.geometry);
      (Array.isArray(node.material) ? node.material : [node.material]).forEach(m => materials.add(m));
    }
  });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
}
