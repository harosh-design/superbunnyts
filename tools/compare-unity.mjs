import fs from 'node:fs/promises';
import { createServer } from 'vite';
const server=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
try {
 const {PhysicsLab}=await server.ssrLoadModule('/src/world/PhysicsLab.ts');
 const {emptyInputFrame}=await server.ssrLoadModule('/src/input/InputFrame.ts');
 const source=JSON.parse(await fs.readFile(new URL('../reference/unity-runtime/current.json',import.meta.url),'utf8'));
 const report={unity:source.unity,dt:source.dt,gravity:source.gravity,scenarios:[],note:'Five controlled scenarios. The port now uses mesh-derived character contours; Unity retains the original primitive rig. This comparison reports trajectory changes, not a target for matching collision geometry.'};
 for(const reference of source.scenarios){
  const lab=new PhysicsLab(reference.name==='lab_idle'?'lab':'flat');
  const jsBodies=[lab.rig.core,lab.rig.legs[0],lab.rig.arms[0],lab.rig.legs[1],lab.rig.arms[1]];
  const massError=Math.max(...jsBodies.map((b,i)=>Math.abs(b.getMass()-reference.initial[i].mass)));
  const inertiaError=Math.max(...jsBodies.map((b,i)=>{const p=b.getLocalCenter();return Math.abs(b.getInertia()-b.getMass()*(p.x*p.x+p.y*p.y)-reference.initial[i].inertia);}));
  let squared=0,maxError=0,angleSquared=0,jsPeak=-Infinity,unityPeak=-Infinity;
  const trajectory=[];
  for(let i=0;i<reference.ticks.length;i++){
   const input=emptyInputFrame();input.roll=i>=20?(reference.name==='flat_right'?1:reference.name==='flat_left'?-1:0):0;input.jumpPressed=reference.name==='flat_jump'&&i===30;
   const recovery=lab.step(input);if(recovery)throw Error(`${reference.name}: ${recovery}`);
   const actual=lab.current.core,expected=reference.ticks[i].core,delta=Math.hypot(actual.x-expected.x,actual.y-expected.y);
   squared+=delta*delta;maxError=Math.max(maxError,delta);angleSquared+=(actual.angle-expected.a)**2;
   jsPeak=Math.max(jsPeak,actual.y);unityPeak=Math.max(unityPeak,expected.y);
   trajectory.push({tick:i,unity:{x:expected.x,y:expected.y,angle:expected.a},port:actual});
  }
  report.scenarios.push({name:reference.name,massErrorKg:massError,inertiaErrorKgM2:inertiaError,positionRmseMetres:Math.sqrt(squared/reference.ticks.length),maxPositionErrorMetres:maxError,angleRmseRadians:Math.sqrt(angleSquared/reference.ticks.length),unityPeakMetres:unityPeak,portPeakMetres:jsPeak,peakErrorMetres:Math.abs(jsPeak-unityPeak),trajectory});
  lab.dispose();
 }
 await fs.writeFile(new URL('../reports/unity-comparison.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report.scenarios.map(({trajectory,...metrics})=>metrics),null,2));
} finally {await server.close();}
