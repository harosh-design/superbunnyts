import * as THREE from 'three';
import type { PhysicsLab, Pose } from '../world/PhysicsLab';
import { CharacterVisual } from './CharacterVisual';
import { WorldVisual, disposeObjects, type Scenery } from './WorldVisual';
import { LabCamera } from './LabCamera';
import { PLAYER_COLORS } from '../world/Actor';
import { DebugDraw } from './DebugDraw';
import { DeathDissolve } from './DeathDissolve';
import { tuning } from '../config/bunnyTuning';

export class SceneRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 300);
  private readonly characters = new Map<number, CharacterVisual>();
  private readonly dissolves = new Map<number, DeathDissolve>();
  private world!: WorldVisual;
  private scenery!: Record<string, Scenery>;
  private sky!: THREE.Texture;
  readonly framing = new LabCamera();
  readonly debug = new DebugDraw();
  private readonly resizeObserver: ResizeObserver;

  static async create(container: HTMLElement, lab: PhysicsLab): Promise<SceneRenderer> {
    const renderer = new SceneRenderer(container);
    try {
      const [, scenery, sky] = await Promise.all([
        CharacterVisual.prepare(),
        Promise.all(['physics-lab', 'dm-flat', 'dm-meadow'].map(async id => { const response = await fetch(`${import.meta.env.BASE_URL}assets/world/${id}.json`); if (!response.ok) throw new Error('Scenery unavailable'); return [id, await response.json()] as const; })).then(entries => Object.fromEntries(entries) as Record<string, Scenery>),
        new THREE.TextureLoader().loadAsync(`${import.meta.env.BASE_URL}assets/world/sky.png`)
      ]);
      renderer.scenery = scenery; renderer.sky = sky;
      sky.colorSpace = THREE.SRGBColorSpace;
      renderer.scene.add(renderer.debug.root);
      renderer.resetCharacter(lab);
      return renderer;
    } catch (error) { renderer.dispose(); throw error; }
  }

  private constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.canvas = this.renderer.domElement;
    this.canvas.setAttribute('aria-label', 'Super Bunny: W — прыжок, A/D — перекат, Space — захват.');
    this.canvas.setAttribute('role', 'img');
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.1;
    container.append(this.canvas);
    this.scene.background = new THREE.Color('#abdafa');
    this.scene.add(new THREE.HemisphereLight('#bfd9ff', '#736b59', 1.8));
    const light = new THREE.DirectionalLight('#fff9e8', 3.2);
    light.position.set(-4, 8, 6); light.castShadow = true; light.shadow.mapSize.set(2048, 2048);
    Object.assign(light.shadow.camera, { left: -15, right: 15, top: 10, bottom: -7 });
    light.shadow.normalBias = 0.015; this.scene.add(light);
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(container); this.resize();
  }

  resetCharacter(lab: PhysicsLab): void {
    this.dissolves.forEach(effect => effect.dispose()); this.dissolves.clear();
    if (this.world) { this.scene.remove(this.world.root); disposeObjects(this.world.root); }
    this.characters.forEach(c => c.dispose()); this.characters.clear();
    this.world = new WorldVisual(lab, this.scenery[lab.scene.startsWith('dm-') ? lab.scene : 'physics-lab'], this.sky); this.scene.add(this.world.root);
    this.syncActors(lab);
  }
  private syncActors(lab: PhysicsLab): void {
    for (const [id, visual] of this.characters) if (!lab.actors.some(a => a.id === id)) {
      visual.dispose(); this.characters.delete(id); this.dissolves.get(id)?.dispose(); this.dissolves.delete(id);
    }
    for (const actor of lab.actors) if (!this.characters.has(actor.id)) {
      const color = lab.match || lab.options.menu ? PLAYER_COLORS[actor.player] : undefined;
      const visual = CharacterVisual.create(actor.model, actor.rig.facing, color);
      this.scene.add(visual.root); visual.reset(actor); this.characters.set(actor.id, visual);
    }
  }
  fixedUpdate(lab: PhysicsLab): void { this.syncActors(lab); for (const actor of lab.actors) if (actor.alive) this.characters.get(actor.id)!.fixedUpdate(actor); }

  render(lab: PhysicsLab, alpha: number, delta: number, snap = false, paused = false): void {
    const { previous, current } = lab;
    const pose = {
      core: interpolate(previous.core, current.core, alpha),
      objects: current.objects.map((b, i) => interpolate(previous.objects[i], b, alpha)),
      legs: current.legs.map((b, i) => interpolate(previous.legs[i], b, alpha)),
      arms: current.arms.map((b, i) => interpolate(previous.arms[i], b, alpha))
    };
    this.syncActors(lab);
    for (const actor of lab.actors) {
      const visual = this.characters.get(actor.id)!;
      if (!actor.alive) {
        if (!this.dissolves.has(actor.id)) {
          visual.pose(actor.current, 1, 0, actor);
          const effect = new DeathDissolve(visual.root); this.scene.add(effect.root); this.dissolves.set(actor.id, effect);
          visual.root.visible = false;
        }
        this.dissolves.get(actor.id)!.update(Math.max(0, lab.time - actor.diedAt - (1 - alpha) * tuning.dt));
        continue;
      }
      const p = actor.previous, c = actor.current;
      visual.pose({ core: interpolate(p.core, c.core, alpha), legs: c.legs.map((b, i) => interpolate(p.legs[i], b, alpha)), arms: c.arms.map((b, i) => interpolate(p.arms[i], b, alpha)), objects: [] }, alpha, paused ? 0 : delta, actor);
    }
    this.world.update(pose.objects); this.debug.update(lab);
    this.framing.update(this.camera, lab, Math.min(delta, 0.16), snap);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.dissolves.forEach(effect => effect.dispose()); this.dissolves.clear();
    const textures = new Set<THREE.Texture>();
    this.scene.traverse(node => {
      if (node instanceof THREE.Mesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if ('map' in material && material.map instanceof THREE.Texture) textures.add(material.map);
      }
    });
    disposeObjects(this.scene); textures.forEach(t => t.dispose()); this.sky?.dispose();
    this.renderer.dispose(); this.canvas.remove();
  }

  private resize(): void {
    const { width, height } = this.container.getBoundingClientRect(); this.renderer.setSize(width, height);
    this.camera.aspect = Math.max(1, width) / Math.max(1, height); this.camera.updateProjectionMatrix();
  }
}

function interpolate(a: Pose, b: Pose, alpha: number): Pose {
  return { x: a.x + (b.x - a.x) * alpha, y: a.y + (b.y - a.y) * alpha, angle: a.angle + (b.angle - a.angle) * alpha };
}
