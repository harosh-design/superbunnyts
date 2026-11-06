import { Color, Group, Mesh, MeshStandardMaterial, Object3D, SkinnedMesh, Vector3 } from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { ModelKind } from '../world/Actor';
import type { VisualContext, BunnyPose } from '../world/PhysicsLab';
import { CharacterSkeleton } from '../character/CharacterSkeleton';
import type { Limb } from './TwoBoneIK';

const HIT_COLOR = new Color('#ff653d');

/** The mesh uses the same skeletal solve as its collision outlines. */
export class CharacterVisual {
  readonly root = new Group();
  readonly overheadAnchor = new Vector3();
  private readonly hitMaterials: { material: MeshStandardMaterial; emissive: Color; intensity: number }[] = [];
  private readonly profile = new Group();
  private readonly skeleton: CharacterSkeleton;
  private readonly bones = new Map<string, Object3D>();
  private readonly arms: Limb[];
  private readonly legs: Limb[];
  private readonly face?: Object3D;
  private readonly deadFace?: Object3D;
  private static readonly templates = new Map<ModelKind, Group>();

  static async prepare(): Promise<void> {
    await Promise.all((['bunny', 'sumo'] as ModelKind[]).map(async model => {
      if(this.templates.has(model))return;
      const gltf=await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}assets/models/${model}.glb`);
      this.templates.set(model,gltf.scene);
    }));
  }
  static create(model: ModelKind = 'bunny', facing = 1, color?: string): CharacterVisual {
    const template=this.templates.get(model);
    if(!template)throw new Error(`Character asset unavailable: ${model}`);
    return new CharacterVisual(clone(template) as Group,model,facing,color);
  }
  static async load(model: ModelKind = 'bunny', facing = 1, color?: string): Promise<CharacterVisual> {
    await this.prepare();return this.create(model,facing,color);
  }
  private constructor(private readonly model: Group, kind: ModelKind, facing: number, color?: string) {
    this.root.name='BunnyVisual';this.skeleton=new CharacterSkeleton(kind,facing);
    // Keep the authored meshes/bind matrices, and copy only the common bone pose.
    this.root.add(this.profile);this.profile.add(model);
    model.traverse(node=>{
      const name=node.userData.name??node.name;
      if(node.type==='Bone'||!this.bones.has(name))this.bones.set(name,node);
      if(!(node instanceof Mesh))return;
      node.material=Array.isArray(node.material)?node.material.map(m=>m.clone()):node.material.clone();
      for(const material of Array.isArray(node.material)?node.material:[node.material]) {
        if(!(material instanceof MeshStandardMaterial))continue;
        if(color&&material.name.startsWith('Suit'))material.color.set(color);
        this.hitMaterials.push({material,emissive:material.emissive.clone(),intensity:material.emissiveIntensity});
      }
      node.castShadow=true;node.receiveShadow=true;
    });
    for(const name of this.skeleton.names.keys())if(!this.bones.has(name))throw new Error(`Character model is missing node: ${name}`);
    this.face=this.bones.get('Face');this.deadFace=this.bones.get('FaceDead');
    const limb=(l:Limb):Limb=>({upper:this.bones.get(l.upper.name)!,lower:this.bones.get(l.lower.name)!,tip:this.bones.get(l.tip.name)!});
    this.arms=this.skeleton.arms.map(limb);this.legs=this.skeleton.legs.map(limb);
  }

  reset(lab: VisualContext): void { this.pose(lab.current,1,0,lab); }
  fixedUpdate(_lab: VisualContext): void {}

  pose(pose: BunnyPose, _alpha: number, _delta: number, lab: VisualContext, time=0): void {
    this.skeleton.solve(pose,lab.rig.handLocal,lab.rig.skin.handDepths.map((d,i)=>lab.rig.skin.previousHandDepths[i]+(d-lab.rig.skin.previousHandDepths[i])*_alpha));
    this.root.position.copy(this.skeleton.root.position);this.root.quaternion.copy(this.skeleton.root.quaternion);
    const profile=this.skeleton.nodes[0].parent!;
    this.profile.position.copy(profile.position);this.profile.quaternion.copy(profile.quaternion);
    for(const source of this.skeleton.nodes) {
      const target=this.bones.get(source.name)!;
      target.position.copy(source.position);target.quaternion.copy(source.quaternion);target.scale.copy(source.scale);
    }
    if(this.face)this.face.visible=lab.alive;
    if(this.deadFace)this.deadFace.visible=!lab.alive;
    const age=time-lab.lastHurtAt, flash=lab.alive&&age>=0?Math.max(0,1-age/.18):0;
    // Combat feedback may tint the skin, but cannot move a striking foot off its collider.
    for(const e of this.hitMaterials) {
      e.material.emissive.copy(e.emissive).lerp(HIT_COLOR,flash);e.material.emissiveIntensity=e.intensity+flash*.9;
    }
    // updateWorldMatrix alone does not refresh SkinnedMesh.bindMatrixInverse.
    this.root.updateMatrixWorld(true);
    const point=new Vector3();let top=pose.core.y;
    for(const node of this.skeleton.nodes)if(node.name==='Head'||node.name.startsWith('Ear'))top=Math.max(top,node.getWorldPosition(point).y);
    this.overheadAnchor.set(pose.core.x,top+.22,0);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.model.traverse(node=>{
      if(!(node instanceof Mesh))return;
      (Array.isArray(node.material)?node.material:[node.material]).forEach(m=>m.dispose());
      if(node instanceof SkinnedMesh)node.skeleton.dispose();
    });
  }
}
