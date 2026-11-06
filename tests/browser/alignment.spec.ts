import { test, expect } from '@playwright/test';

test.beforeEach(async({page})=>{
  test.skip(!!process.env.BUNNY_TEST_URL,'Geometry diagnostics import Vite modules; UI tests also cover production.');
  await page.goto('/?mute=1');await expect(page.locator('.loading')).toHaveCount(0);
});

test('actual GLB contours follow every physical body in both profiles and asymmetric poses',async({page},info)=>{
 const result=await page.evaluate(async()=>{
  const [{PhysicsLab},{Actor},{CharacterVisual},{Vector3}]=await Promise.all([
   import('/src/world/PhysicsLab.ts'),import('/src/world/Actor.ts'),import('/src/render/CharacterVisual.ts'),import('/node_modules/.vite/deps/three.js')]);
  await CharacterVisual.prepare();const results=[];
  for(const model of ['bunny','sumo'])for(const facing of [-1,1]) {
   const lab=new PhysicsLab('flat'),actor=new Actor(lab.world,lab.environment,100,0,{x:0,y:3},facing,model);
   const visual=CharacterVisual.create(model,facing);
   for(const angle of [0,.6,Math.PI/2,Math.PI,4.7]) {
    const old=actor.rig.core.getPosition().clone(),d=angle-actor.rig.core.getAngle(),c=Math.cos(d),s=Math.sin(d);
    for(const body of actor.rig.bodies){const p=body.getPosition(),dx=p.x-old.x,dy=p.y-old.y;body.setTransform({x:dx*c-dy*s,y:3+dx*s+dy*c},body.getAngle()+d);}
    actor.rig.legs.forEach((b:any,i:number)=>{const p=b.getPosition(),offset=i===0?.025:-.025;b.setPosition({x:p.x-Math.sin(angle)*offset,y:p.y+Math.cos(angle)*offset});});
    actor.rig.arms.forEach((b:any,i:number)=>b.setAngle(angle+(i===0?.7:-.5)*facing));
    actor.current=actor.previous=actor.capture();actor.rig.skin.sync();visual.pose(actor.current,1,0,actor);
    const groups=new Map<string,any[]>();
    const add=(name:string,p:any)=>{if(['Root','Spine','Belly'].includes(name))name='torso';const points=groups.get(name)??[];groups.set(name,points);points.push(p);};
    visual.root.traverse((node:any)=>{
     if(!node.isMesh)return;
     if(node.isSkinnedMesh) {
      const si=node.geometry.attributes.skinIndex,sw=node.geometry.attributes.skinWeight;
      for(let i=0;i<si.count;i++) {
       let main=0;for(let k=1;k<4;k++)if(sw.getComponent(i,k)>sw.getComponent(i,main))main=k;
       const bone=node.skeleton.bones[si.getComponent(i,main)];
       add(bone.userData.name??bone.name,node.localToWorld(node.getVertexPosition(i,new Vector3())));
      }
     } else {
      let bone=node.parent;while(bone&&!bone.isBone)bone=bone.parent;if(!bone)return;
      const pos=node.geometry.attributes.position;
      for(let i=0;i<pos.count;i++)add(bone.userData.name??bone.name,node.localToWorld(new Vector3().fromBufferAttribute(pos,i)));
     }
    });
    for(const surface of lab.environment.surfaces.all.filter((s:any)=>s.ownerId===actor.id)) {
     const name=surface.fixtures[0].getUserData().region,points=groups.get(name)!;
     const declared=surface.shape.vertices.map((v:any)=>surface.body.getWorldPoint(v));
     const physical=surface.fixtures.flatMap((f:any)=>f.getShape().m_vertices.slice(0,f.getShape().m_count).map((v:any)=>f.getBody().getWorldPoint(v)));
     let geometryError=0,fixtureError=0;
     for(let i=0;i<64;i++) {
      const x=Math.cos(i*Math.PI/32),y=Math.sin(i*Math.PI/32),support=(vs:any[])=>vs.reduce((best,p)=>Math.max(best,p.x*x+p.y*y),-Infinity);
      geometryError=Math.max(geometryError,Math.abs(support(points)-support(declared)));
      fixtureError=Math.max(fixtureError,Math.abs(support(points)-support(physical)));
     }
     results.push({model,facing,angle,name,geometryError,fixtureError});
    }
   }
   visual.dispose();lab.dispose();
  }
  return results;
 });
 await info.attach('geometry-measurements',{body:JSON.stringify(result,null,2),contentType:'application/json'});
 expect(result).toHaveLength(330);
 expect(result.filter((r:any)=>r.geometryError>.004||r.fixtureError>.006)).toEqual([]);
});

test('fallen Bunny and Sumo skins rest on the floor with no invisible support gap',async({page},info)=>{
 const results=await page.evaluate(async()=>{
  const [{PhysicsLab},{CharacterVisual},{SceneRenderer},{Vector3}]=await Promise.all([
   import('/src/world/PhysicsLab.ts'),import('/src/render/CharacterVisual.ts'),import('/src/render/SceneRenderer.ts'),import('/node_modules/.vite/deps/three.js')]);
  await CharacterVisual.prepare();const results=[];
  for(const model of ['bunny','sumo'])for(const angle of [0,Math.PI/2,Math.PI,4.7]) {
   const lab=new PhysicsLab('flat',{x:0,y:1.3},{model}),actor=lab.players[0].actor,origin=actor.rig.core.getPosition().clone();
   for(const b of actor.rig.bodies){const p=b.getPosition(),dx=p.x-origin.x,dy=p.y-origin.y;b.setTransform({x:dx*Math.cos(angle)-dy*Math.sin(angle),y:1.4+dx*Math.sin(angle)+dy*Math.cos(angle)},angle);}
   actor.motor.goLimp();actor.rig.skin.sync();
   for(let i=0;i<250;i++)lab.step({roll:0,jumpHeld:false,jumpPressed:false,grabHeld:false});
   const visual=CharacterVisual.create(model,1);visual.pose(actor.current,1,0,actor);let bottom=Infinity;
   visual.root.traverse((n:any)=>{if(!n.isMesh||!n.visible)return;const pos=n.geometry.attributes.position;for(let i=0;i<pos.count;i++){const p=n.isSkinnedMesh?n.getVertexPosition(i,new Vector3()):new Vector3().fromBufferAttribute(pos,i);n.localToWorld(p);bottom=Math.min(bottom,p.y);}});
   let contacts=0;for(let c=lab.world.getContactList();c;c=c.getNext())if(c.isTouching()&&c.isEnabled())contacts++;
   results.push({model,angle,bottom,contacts});visual.dispose();
   if(angle===Math.PI/2) {
    const container=document.createElement('div');container.style.cssText='position:fixed;inset:0;z-index:999';document.body.append(container);
    const renderer=await SceneRenderer.create(container,lab);renderer.render(lab,1,.02,true);
    (window as any).floorPreview?.renderer.dispose();(window as any).floorPreview?.container.remove();
    (window as any).floorPreview={renderer,container,lab};
   } else lab.dispose();
  }
  return results;
 });
 for(const r of results) {expect(r.contacts,JSON.stringify(r)).toBeGreaterThan(0);expect(r.bottom,JSON.stringify(r)).toBeGreaterThan(-.012);expect(r.bottom,JSON.stringify(r)).toBeLessThan(.012);}
 await info.attach('floor-measurements',{body:JSON.stringify(results,null,2),contentType:'application/json'});
 await page.screenshot({path:info.outputPath('sumo-floor-contact.png')});
});

test('player grips touch the visible opponent in XY and Z, including the first frame',async({page},info)=>{
 const result=await page.evaluate(async()=>{
  const [{PhysicsLab},{Actor},{CharacterVisual},{Vector3,Triangle}]=await Promise.all([
   import('/src/world/PhysicsLab.ts'),import('/src/world/Actor.ts'),import('/src/render/CharacterVisual.ts'),import('/node_modules/.vite/deps/three.js')]);
  await CharacterVisual.prepare();const results=[];
  for(const model of ['bunny','sumo'])for(const facing of [-1,1])for(const part of ['Head','torso','Foot.L']) {
   const lab=new PhysicsLab('dm-flat',undefined,{model});lab.match.phase='playing';
   let holder=lab.players[0].actor;
   if(facing===-1){lab.environment.surfaces.removeOwner(holder.id);holder.rig.bodies.forEach((b:any)=>lab.world.destroyBody(b));holder=new Actor(lab.world,lab.environment,100,0,{x:0,y:0},facing,model);lab.actors[0]=lab.players[0].actor=holder;}
   const victim=lab.players[1].actor;
   const translate=(a:any,dx:number,dy:number)=>{for(const b of a.rig.bodies){const p=b.getPosition();b.setPosition({x:p.x+dx,y:p.y+dy});b.setLinearVelocity({x:0,y:0});b.setAngularVelocity(0);}a.rig.skin.sync();a.current=a.previous=a.capture();};
   const origin=holder.rig.core.getPosition().clone();translate(holder,-origin.x,3-origin.y);
   const vertices=(s:any)=>s.shape.vertices.map((p:any)=>s.body.getWorldPoint(p));
   const hand=vertices(holder.rig.skin.hands[0]).reduce((a:any,b:any)=>a.x*facing>b.x*facing?a:b);
   const target=lab.environment.surfaces.all.find((s:any)=>s.ownerId===victim.id&&s.fixtures[0].getUserData().region===part);
   const edge=vertices(target).reduce((a:any,b:any)=>a.x*facing<b.x*facing?a:b);
   translate(victim,hand.x+.002*facing-edge.x,hand.y-edge.y);
   const a=CharacterVisual.create(model,facing),b=CharacterVisual.create('bunny',victim.rig.facing);
   let samples=0;
   for(let tick=0;tick<18;tick++) {
    lab.step([{roll:0,jumpPressed:false,jumpHeld:false,grabHeld:true},{roll:0,jumpPressed:false,jumpHeld:false,grabHeld:false}]);
    if(tick!==0&&tick!==15)continue;
    for(const alpha of [0,.5,1]) {
     const interpolate=(actor:any)=>{const lerp=(p:any,c:any)=>({x:p.x+(c.x-p.x)*alpha,y:p.y+(c.y-p.y)*alpha,angle:p.angle+(c.angle-p.angle)*alpha});return {core:lerp(actor.previous.core,actor.current.core),arms:actor.current.arms.map((p:any,i:number)=>lerp(actor.previous.arms[i],p)),legs:actor.current.legs.map((p:any,i:number)=>lerp(actor.previous.legs[i],p)),objects:[]};};
     a.pose(interpolate(holder),alpha,.001,holder);b.pose(interpolate(victim),alpha,.001,victim);
     for(let arm=0;arm<2;arm++) {
      if(holder.grab.held[arm]?.ownerId!==victim.id)continue;samples++;
      const points:any[]=[];
      a.root.traverse((n:any)=>{if(!n.isSkinnedMesh)return;const bone=n.skeleton.bones.indexOf(a.arms[arm].tip);if(bone<0)return;const si=n.geometry.attributes.skinIndex,sw=n.geometry.attributes.skinWeight;
       for(let i=0;i<si.count;i++){let weight=0;for(let k=0;k<4;k++)if(si.getComponent(i,k)===bone)weight+=sw.getComponent(i,k);if(weight>.5)points.push(n.localToWorld(n.getVertexPosition(i,new Vector3())));}
      });
      const min=new Vector3(Infinity,Infinity,Infinity),max=min.clone().negate();points.forEach(p=>{min.min(p);max.max(p);});
      let meshGap=Infinity;const nearest=new Vector3(),triangle=new Triangle();
      b.root.traverse((n:any)=>{if(!n.isMesh||!n.visible)return;const pos=n.geometry.attributes.position,index=n.geometry.index;
       const vs=Array.from({length:pos.count},(_,i)=>n.localToWorld(n.isSkinnedMesh?n.getVertexPosition(i,new Vector3()):new Vector3().fromBufferAttribute(pos,i)));
       for(let i=0;i<(index?.count??pos.count);i+=3){triangle.set(vs[index?index.getX(i):i],vs[index?index.getX(i+1):i+1],vs[index?index.getX(i+2):i+2]);
        const dx=Math.max(0,Math.min(triangle.a.x,triangle.b.x,triangle.c.x)-max.x,min.x-Math.max(triangle.a.x,triangle.b.x,triangle.c.x));
        const dy=Math.max(0,Math.min(triangle.a.y,triangle.b.y,triangle.c.y)-max.y,min.y-Math.max(triangle.a.y,triangle.b.y,triangle.c.y));
        const dz=Math.max(0,Math.min(triangle.a.z,triangle.b.z,triangle.c.z)-max.z,min.z-Math.max(triangle.a.z,triangle.b.z,triangle.c.z));
        if(dx*dx+dy*dy+dz*dz>=meshGap*meshGap)continue;
        for(const p of points){triangle.closestPointToPoint(p,nearest);meshGap=Math.min(meshGap,p.distanceTo(nearest));}
       }
      });
      const joint=holder.grab.joints[arm],anchorA=joint.getAnchorA(),anchorB=joint.getAnchorB(),held=holder.grab.held[arm];
      const colliderGap=Math.min(...points.map(p=>{const q=held.closestAt(p,alpha);return Math.hypot(p.x-q.x,p.y-q.y);}));
      results.push({model,facing,part,tick,alpha,arm,meshGap,colliderGap,jointError:Math.hypot(anchorA.x-anchorB.x,anchorA.y-anchorB.y),depthError:held.depthAt(anchorB)-holder.rig.skin.hands[arm].depthAt(anchorA)});
     }
    }
   }
   results.push({model,facing,part,samples});a.dispose();b.dispose();
   if(model==='bunny'&&facing===1&&part==='torso')(window as any).gripPreview=lab;else lab.dispose();
  }
  return results;
 });
 await info.attach('grip-measurements',{body:JSON.stringify(result,null,2),contentType:'application/json'});
 for(const r of result) {
  if('samples' in r)expect(r.samples,JSON.stringify(r)).toBeGreaterThanOrEqual(6);
  else expect(r.meshGap,JSON.stringify(r)).toBeLessThan(.012);
 }
 await page.evaluate(async()=>{const {SceneRenderer}=await import('/src/render/SceneRenderer.ts');const container=document.createElement('div');container.style.cssText='position:fixed;inset:0;z-index:999';document.body.append(container);const lab=(window as any).gripPreview,renderer=await SceneRenderer.create(container,lab);renderer.render(lab,1,.02,true);});
 await page.screenshot({path:info.outputPath('bunny-body-grip.png')});

});
