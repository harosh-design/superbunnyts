import fs from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
globalThis.ProgressEvent ??= class ProgressEvent {};
export async function loadModel(model){
 const b=fs.readFileSync(`public/assets/models/${model}.glb`),len=b.readUInt32LE(12);const doc=JSON.parse(b.subarray(20,20+len).toString());const bin=b.subarray(28+len);
 delete doc.images;delete doc.textures;delete doc.materials;for(const mesh of doc.meshes)for(const p of mesh.primitives)delete p.material;
 doc.buffers[0].uri=`data:application/octet-stream;base64,${bin.toString('base64')}`;
 return (await new GLTFLoader().parseAsync(JSON.stringify(doc), '')).scene;
}
