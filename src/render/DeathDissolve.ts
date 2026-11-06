import { BufferGeometry, Color, DataTexture, Float32BufferAttribute, LinearFilter, Mesh, Object3D, Points, PointsMaterial, Vector3 } from 'three';
import { MATCH_RULES } from '../world/Deathmatch';

/** One short burst sampled from the character's final skinned pose. */
export class DeathDissolve {
  readonly root: Points<BufferGeometry, PointsMaterial>;
  private readonly origins: Float32Array;
  private readonly velocities: Float32Array;
  private readonly texture: DataTexture;

  constructor(source: Object3D) {
    source.updateMatrixWorld(true);
    const meshes: Mesh[] = [];
    source.traverseVisible(node => { if (node instanceof Mesh) meshes.push(node); });
    const total = meshes.reduce((n, mesh) => n + mesh.geometry.getAttribute('position').count, 0);
    const positions: number[] = [], colors: number[] = [], velocities: number[] = [];
    const center = source.getWorldPosition(new Vector3()), point = new Vector3();
    let serial = 0;
    for (const mesh of meshes) {
      const count = mesh.geometry.getAttribute('position').count;
      const samples = Math.max(1, Math.round(360 * count / Math.max(1, total)));
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const vertexMaterials = new Uint16Array(count), index = mesh.geometry.index;
      for (const group of mesh.geometry.groups) for (let j = group.start; j < group.start + group.count; j++) {
        vertexMaterials[index ? index.getX(j) : j] = group.materialIndex ?? 0;
      }
      for (let i = 0; i < samples; i++) {
        const vertex = Math.min(count - 1, Math.floor((i + 0.5) * count / samples));
        mesh.localToWorld(mesh.getVertexPosition(vertex, point));
        positions.push(point.x, point.y, point.z);
        // Seeded directions make replayed deaths look the same without touching
        // the simulation's random sequence. Scatter in world space, away and up.
        const seed = ++serial;
        const dx = point.x - center.x, dy = point.y - center.y;
        velocities.push(dx * 2.2 + noise(seed) * 1.1, dy * 1.3 + 0.65 + noise(seed + 73) * 0.7, noise(seed + 151) * 0.8);
        const material = materials[vertexMaterials[vertex]] ?? materials[0];
        const color = 'color' in material && material.color instanceof Color ? material.color : new Color('#ffffff');
        colors.push(color.r, color.g, color.b);
      }
    }
    this.origins = new Float32Array(positions); this.velocities = new Float32Array(velocities);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    const pixels = new Uint8Array(16 * 16 * 4);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const i = (y * 16 + x) * 4, radius = Math.hypot((x - 7.5) / 7.5, (y - 7.5) / 7.5);
      pixels.set([255, 255, 255, Math.round(Math.max(0, 1 - radius) * 255)], i);
    }
    this.texture = new DataTexture(pixels, 16, 16); this.texture.magFilter = this.texture.minFilter = LinearFilter; this.texture.needsUpdate = true;
    this.root = new Points(geometry, new PointsMaterial({ map: this.texture, size: 0.065, vertexColors: true, transparent: true, depthWrite: false, opacity: 1 }));
    this.root.name = 'DeathDissolve'; this.root.frustumCulled = false;
  }

  update(elapsed: number): void {
    const progress = Math.max(0, Math.min(1, elapsed / MATCH_RULES.deathDissolveDuration));
    const t = progress * MATCH_RULES.deathDissolveDuration;
    const positions = this.root.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      const j = i * 3;
      positions.setXYZ(i, this.origins[j] + this.velocities[j] * t,
        this.origins[j + 1] + this.velocities[j + 1] * t + 0.4 * t * t,
        this.origins[j + 2] + this.velocities[j + 2] * t);
    }
    positions.needsUpdate = true;
    this.root.material.opacity = (1 - progress) ** 1.5;
    this.root.material.size = 0.065 * (1 - progress * 0.5);
    this.root.visible = progress < 1;
  }

  dispose(): void {
    this.root.removeFromParent(); this.root.geometry.dispose(); this.root.material.dispose(); this.texture.dispose();
  }
}

function noise(seed: number): number {
  const value = Math.sin(seed * 127.1) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}
