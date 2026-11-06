/** npm-independent, deterministic collider source from the shipped GLBs.
 * Run: node tools/export-assets/colliders.mjs
 * Uses actual skinned vertices, retaining every blend seam and the 3D convex
 * hull of each rigid region. No artist-authored dimensions or browser needed.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Vector3 } from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { loadModel } from './load-glb.mjs';
const output={};
const round=(_key,value)=>typeof value==='number'?Math.round(value*1e6)/1e6:value;
for(const model of ['bunny','sumo']) {
 const scene=await loadModel(model);scene.updateMatrixWorld(true);
 const objects=[];scene.traverse(n=>{if(!n.isMesh)objects.push(n);});
 const nodes=objects.map(n=>({name:n.userData.name??n.name,parent:objects.indexOf(n.parent),p:n.position.toArray(),q:n.quaternion.toArray(),s:n.scale.toArray()}));
 const groups=new Map();
 scene.traverse(mesh=>{
  if(!mesh.isMesh)return;
  if(!mesh.isSkinnedMesh) {
   let bone=mesh.parent;while(bone&&!bone.isBone)bone=bone.parent;
   if(!bone)return;
   const name=bone.userData.name??bone.name,entries=groups.get(name)??new Map();groups.set(name,entries);
   const position=mesh.geometry.attributes.position;
   for(let i=0;i<position.count;i++) {
    const p=mesh.localToWorld(new Vector3().fromBufferAttribute(position,i)),local=bone.worldToLocal(p.clone());
    const influences=[[objects.indexOf(bone),...local.toArray(),1]];
    entries.set(JSON.stringify([p.toArray(),influences]),{p,main:1,influences});
   }
   return;
  }
  const si=mesh.geometry.attributes.skinIndex,sw=mesh.geometry.attributes.skinWeight;
  for(let i=0;i<si.count;i++) {
   const p=mesh.localToWorld(mesh.getVertexPosition(i,new Vector3()));
   let main=0;for(let k=1;k<4;k++)if(sw.getComponent(i,k)>sw.getComponent(i,main))main=k;
   const bone=mesh.skeleton.bones[si.getComponent(i,main)],name=bone.userData.name??bone.name;
   const influences=[];
   for(let k=0;k<4;k++)if(sw.getComponent(i,k)>.00001){
    const b=mesh.skeleton.bones[si.getComponent(i,k)],local=b.worldToLocal(p.clone());
    influences.push([objects.indexOf(b),...local.toArray(),sw.getComponent(i,k)]);
   }
   // Core bones have no independent visual deformation: collapse their weights
   // exactly, so face/detail geometry does not inflate the runtime skin cache.
   if(influences.every(([index])=>!/Arm|Forearm|Mitten|Thigh|Shin|Foot/.test(nodes[index].name))) {
    const local=bone.worldToLocal(p.clone());influences.splice(0,influences.length,[objects.indexOf(bone),...local.toArray(),1]);
   }
   const entries=groups.get(name)??new Map();groups.set(name,entries);
   entries.set(JSON.stringify([p.toArray(),influences]),{p,main:sw.getComponent(i,main),influences});
  }
 });
 const regions=[];
 for(const [name,entries] of groups) {
  const points=[...entries.values()];const byPoint=new Map(points.map(p=>[p.p,p]));
  const selected=new Set(points.filter(p=>p.influences.length>1));
  const rigid=points.filter(p=>p.influences.length===1);
  if(/UpperArm|Forearm|Thigh|Shin/.test(name)&&rigid.length>3) {
   const hull=new ConvexHull().setFromPoints(rigid.map(p=>p.p));
   for(const face of hull.faces){let edge=face.edge;do{selected.add(byPoint.get(edge.head().point));edge=edge.next;}while(edge!==face.edge);}
  } else for(const facing of [-1,1]) {
   const projected=rigid.map(entry=>({entry,x:entry.p.x*Math.cos(Math.PI*65/180)+entry.p.z*Math.sin(Math.PI*65/180)*facing,y:entry.p.y})).sort((a,b)=>a.x-b.x||a.y-b.y);
   const half=ps=>{const h=[];for(const p of ps){while(h.length>1){const a=h[h.length-2],b=h[h.length-1];if((b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x)>1e-10)break;h.pop();}h.push(p);}return h;};
   for(const p of [...half(projected),...half([...projected].reverse())])selected.add(p.entry);
  }
  regions.push({name,vertices:[...selected].map(p=>p.influences)});
 }
 output[model]={profileYaw:65,sha256:crypto.createHash('sha256').update(fs.readFileSync(`public/assets/models/${model}.glb`)).digest('hex'),nodes,regions};
 output[model].geometrySha256=crypto.createHash('sha256').update(JSON.stringify(output[model],round)).digest('hex');
 console.log(model,regions.map(r=>`${r.name}:${r.vertices.length}`).join(' '));
}
fs.writeFileSync('src/config/characterGeometry.json',JSON.stringify(output,round)+'\n');
