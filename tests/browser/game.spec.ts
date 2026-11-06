import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

test.beforeEach(async ({page}) => {
 const errors: string[]=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()}: ${r.url()}`);});
 await page.goto('/?mute=1');await expect(page.locator('.loading')).toHaveCount(0);
 (page as unknown as {gameErrors:string[]}).gameErrors=errors;
});
test.afterEach(async ({page}) => { expect((page as unknown as {gameErrors:string[]}).gameErrors).toEqual([]); });

test('four-player Meadow, source Sumo and two-player recording',async({page},testInfo)=>{
 await page.locator('#player-count').selectOption('4');await page.locator('#player-model').selectOption('sumo');await page.locator('#match-map').selectOption('dm-meadow');
 await page.locator('#start').click();await expect(page.locator('#scoreboard .player-badge')).toHaveCount(4);
 await expect(page.getByRole('progressbar')).toHaveCount(4);
 for (const bar of await page.getByRole('progressbar').all()) await expect(bar).toHaveAttribute('aria-valuenow','100');
 await page.waitForTimeout(400);await page.screenshot({path:testInfo.outputPath('meadow-four-players.png')});
 await page.keyboard.press('KeyQ');await expect(page.locator('#start-overlay')).toBeVisible();
 await page.locator('#player-count').selectOption('2');await page.locator('#player-model').selectOption('bunny');await page.locator('#match-map').selectOption('dm-flat');await page.keyboard.press('Enter');
 await expect(page.locator('#scoreboard .player-badge')).toHaveCount(2);
 await page.locator('.tools summary').click();await page.locator('#record').click();
 await page.waitForTimeout(3300);await page.keyboard.down('ArrowLeft');await page.keyboard.press('ArrowUp');await page.keyboard.down('Space');await page.waitForTimeout(350);await page.keyboard.up('ArrowLeft');await page.keyboard.up('Space');
 await page.locator('#record').click();const downloadPromise=page.waitForEvent('download');await page.locator('#download').click();const download=await downloadPromise;
 const replay=JSON.parse(await fs.readFile((await download.path())!,'utf8'));
 expect(replay.version).toBe(2);expect(replay.options.players).toBe(2);expect(replay.frames.some((tick:any[])=>tick[1].jumpPressed&&tick[1].roll===-1)).toBe(true);expect(replay.frames.some((tick:any[])=>tick[0].grabHeld)).toBe(true);
 await page.locator('#upload').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{}')});await expect(page.locator('.toast')).toContainText('другой версии');
 await page.locator('#upload').setInputFiles({name:'recording.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(replay))});await expect(page.locator('.toast')).toHaveText('Повтор загружен');
 await page.locator('#replay').click();await expect(page.locator('#replay-status')).toContainText('Повтор:');
 await page.waitForTimeout(500);await page.keyboard.press('KeyQ');await expect(page.locator('#start-overlay')).toBeVisible();
});

test('gripping hands reach the physics contact with the actual character assets',async({page})=>{
 test.skip(!!process.env.BUNNY_TEST_URL,'Asset probes use Vite source modules; the UI scenarios also run against production.');
 const measurements=await page.evaluate(async()=>{
  const physicsPath='/src/world/PhysicsLab.ts',visualPath='/src/render/CharacterVisual.ts';
  const [{PhysicsLab},{CharacterVisual}]=await Promise.all([import(physicsPath),import(visualPath)]);
  const results: {scene:string;tick:number;wristError:number;meshGap:number}[]=[];
  const cases=[{scene:'lab',part:'object',facing:1,model:'bunny'},{scene:'vine',part:'object',facing:1,model:'bunny'}];
  for(const part of ['head','body'])for(const facing of [1,-1])for(const model of ['bunny','sumo'])cases.push({scene:'dm-flat',part,facing,model});
  for(const scenario of cases) {
   const {scene,part,facing,model}=scenario;
   const lab=new PhysicsLab(scene,scene==='lab'?{x:.4,y:.64}:undefined);
   const holder=lab.players[facing===1?0:1]?.actor??lab.players[0].actor;
   if(part!=='object') {
    lab.match.phase='playing';
    const victim=lab.players[holder.player===0?1:0].actor;
    for(const [actor,x,y] of [[holder,0,3],[victim,facing*(part==='head'?.625:.63),part==='head'?2.9:3.24]] as const) {
     const origin=actor.rig.core.getPosition().clone();
     for(const body of actor.rig.bodies){const p=body.getPosition();body.setTransform({x:x+p.x-origin.x,y:y+p.y-origin.y},body.getAngle());body.setLinearVelocity({x:0,y:0});body.setAngularVelocity(0);}
     actor.current=actor.previous=actor.capture();
    }
   }
   const visual=CharacterVisual.create(model,holder.rig.facing);visual.reset(holder);
   const vector=()=>visual.root.position.clone().set(0,0,0);
   for(let tick=0;tick<35;tick++) {
    lab.step(lab.players.map((p:any)=>({roll:0,jumpHeld:false,jumpPressed:false,grabHeld:p.actor===holder})));
    if(tick!==0&&tick!==30)continue;
    for(const alpha of [0,.5,1]) {
    const lerp=(a:any,b:any)=>({x:a.x+(b.x-a.x)*alpha,y:a.y+(b.y-a.y)*alpha,angle:a.angle+(b.angle-a.angle)*alpha});
    const pose={core:lerp(holder.previous.core,holder.current.core),legs:holder.current.legs.map((p:any,i:number)=>lerp(holder.previous.legs[i],p)),arms:holder.current.arms.map((p:any,i:number)=>lerp(holder.previous.arms[i],p)),objects:[]};
    // Even the very first rendered grip must reach; no smoothing delay.
    for(let frame=0;frame<3;frame++)visual.pose(pose,alpha,.001,holder);
    visual.root.updateMatrixWorld(true);
    for(let i=0;i<2;i++) {
     const surface=holder.grab.held[i];if(!surface)continue;
     const tip=visual.arms[i].tip, wrist=tip.getWorldPosition(vector());
     const arm=pose.arms[i],hand={x:arm.x+holder.rig.handLocal.x*Math.cos(arm.angle),y:arm.y+holder.rig.handLocal.x*Math.sin(arm.angle)};
     let meshGap=Infinity;
     visual.root.traverse((node:any)=>{
      if(!node.isSkinnedMesh)return;
      const bone=node.skeleton.bones.indexOf(tip);if(bone<0)return;
      const indices=node.geometry.attributes.skinIndex,weights=node.geometry.attributes.skinWeight;
      for(let vertex=0;vertex<indices.count;vertex++) {
       let influence=0;
       for(let k=0;k<4;k++)if(indices.getComponent(vertex,k)===bone)influence+=weights.getComponent(vertex,k);
       if(influence<.5)continue;
       const p=node.localToWorld(node.getVertexPosition(vertex,vector())),nearest=surface.closestAt(p,alpha);
       meshGap=Math.min(meshGap,Math.hypot(p.x-nearest.x,p.y-nearest.y));
      }
     });
     results.push({scene:`${scene}/${part}/${facing}/${model}/${alpha}`,tick,wristError:Math.hypot(wrist.x-hand.x,wrist.y-hand.y),meshGap});
    }
    }
   }
   visual.dispose();lab.dispose();
  }
  return results;
 });
 expect(measurements).toHaveLength(120);
 for(const measurement of measurements) {
  // The rendered wrist may move within the physical glove radius to compensate
  // for the asset's smaller hand mesh; its visible surface must touch.
  expect(measurement.wristError,JSON.stringify(measurement)).toBeLessThan(.065);
 }
 expect(measurements.filter(m=>m.meshGap>=.006)).toEqual([]);
});

test('health HUD follows damage in a deterministic four-player replay',async({page},testInfo)=>{
 test.skip(!!process.env.BUNNY_TEST_URL,'Replay fixture generation uses Vite source modules.');
 const {replay,health}=await page.evaluate(async()=>{
  const replayPath='/src/debug/Replay.ts',physicsPath='/src/world/PhysicsLab.ts';
  const [{newReplay},{PhysicsLab}]=await Promise.all([import(replayPath),import(physicsPath)]);
  const replay=newReplay('dm-flat',{players:4}),lab=new PhysicsLab('dm-flat',undefined,replay.options);
  let seed=17;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<600;i++) {
   const frames=Array.from({length:4},()=>({roll:random()<.3?-1:random()<.5?1:0,jumpPressed:random()<.08,grabHeld:random()<.6,jumpHeld:false}));
   replay.frames.push(frames);lab.step(frames);
   if(lab.players.some((p:any)=>p.actor.alive&&p.actor.health<99))break;
  }
  return {replay,health:lab.players.map((p:any)=>Math.ceil(p.actor.health))};
 });
 expect(health.some((hp:number)=>hp<100)).toBe(true);
 await page.locator('#start').click();await page.locator('.tools summary').click();
 await page.locator('#upload').setInputFiles({name:'combat.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(replay))});
 await expect(page.locator('.toast')).toHaveText('Повтор загружен');await page.locator('#replay').click();
 await expect(page.locator('#pause-overlay')).toBeVisible({timeout:20000});
 for(let i=0;i<4;i++)await expect(page.getByRole('progressbar',{name:`Здоровье P${i+1}`})).toHaveAttribute('aria-valuenow',String(health[i]));
 await page.locator('#resume').click();
 await page.screenshot({path:testInfo.outputPath('health-damage-hud.png')});
});

test('vine grips, pause/reset, debug draw and narrow viewport',async({page},testInfo)=>{
 await page.locator('.lab-menu summary').click();await page.locator('#start-scene').selectOption('vine');await page.locator('#start-lab').click();
 await page.keyboard.down('Space');await expect(page.locator('#grips')).toHaveText('2/2');
 await page.waitForTimeout(300);await page.screenshot({path:testInfo.outputPath('vine-grip.png')});
 await page.keyboard.press('Escape');const ticks=await page.locator('#ticks').innerText();await page.waitForTimeout(200);await expect(page.locator('#ticks')).toHaveText(ticks);await expect(page.locator('#pause-overlay')).toBeVisible();
 await page.keyboard.up('Space');await page.keyboard.press('KeyR');await expect(page.locator('#pause-overlay')).toBeHidden();
 await page.locator('.tools summary').click();await page.locator('#debug').check();await page.locator('#fixed-camera').check();await page.locator('#scene-select').selectOption('lab');await page.waitForTimeout(160);
 await page.keyboard.press('KeyW');await page.waitForTimeout(250);await expect(page.locator('.state')).toHaveAttribute('data-state','air');
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150);await page.screenshot({path:testInfo.outputPath('lab-narrow-debug.png')});
 await page.keyboard.press('KeyQ');await expect(page.locator('#start-overlay')).toBeVisible();
});

test('real match ends, shows results and restarts',async({page},testInfo)=>{
 await page.locator('#match-lives').selectOption('1');await page.locator('#start').click();
 await expect(page.locator('#match-banner')).toHaveText('3');await page.waitForTimeout(3300);
 await page.keyboard.down('KeyA');await expect(page.locator('#results')).toBeVisible({timeout:22000});await page.keyboard.up('KeyA');
 await expect(page.locator('#winner')).toHaveText(/P[12] побеждает!|Ничья!/);await page.screenshot({path:testInfo.outputPath('results.png')});
 await expect(page.locator('#rematch')).toBeEnabled({timeout:3000});await page.locator('#rematch').click();await expect(page.locator('#results')).toBeHidden();await expect(page.locator('#match-banner')).toHaveText('3');
});

test('Bunny and Sumo dissolve immediately and finish before a replacement appears',async({page},testInfo)=>{
 test.skip(!!process.env.BUNNY_TEST_URL,'The deterministic death preview uses Vite source modules.');
 await page.locator('#start').click();await page.keyboard.press('Escape');
 for(const model of ['bunny','sumo']) {
  const initial=await page.evaluate(async(model)=>{
   const physicsPath='/src/world/PhysicsLab.ts',rendererPath='/src/render/SceneRenderer.ts';
   const [{PhysicsLab},{SceneRenderer}]=await Promise.all([import(physicsPath),import(rendererPath)]);
   const lab=new PhysicsLab('dm-flat',undefined,{lives:2,model});lab.match.phase='playing';
   for(const [i,actor] of lab.actors.entries()) {
    const origin=actor.rig.core.getPosition().clone();
    for(const body of actor.rig.bodies){const p=body.getPosition();body.setTransform({x:(i===0?-.65:.65)+p.x-origin.x,y:.605+p.y-origin.y},body.getAngle());}
   }
   const empty=()=>lab.players.map(()=>({roll:0,jumpHeld:false,jumpPressed:false,grabHeld:false}));
   for(let i=0;i<15;i++)lab.step(empty());
   const container=document.createElement('div');container.style.cssText='position:fixed;inset:0;z-index:100';document.body.append(container);
   const renderer=await SceneRenderer.create(container,lab);renderer.render(lab,1,.02,true);
   const dead=lab.players[0].actor;lab.eliminate(0,'head',1);renderer.render(lab,1,0,true);
   const effect=renderer.dissolves.get(dead.id);
   (window as any).deathPreview={lab,renderer,container,dead,empty,initialPositions:Array.from(effect.root.geometry.getAttribute('position').array)};
   return {solidVisible:renderer.characters.get(dead.id).root.visible,particles:effect.root.geometry.getAttribute('position').count,
    opacity:effect.root.material.opacity,activeBodies:dead.rig.bodies.filter((b:any)=>b.isActive()).length,lives:lab.players[0].lives};
  },model);
  expect(initial.solidVisible).toBe(false);expect(initial.particles).toBeGreaterThan(300);expect(initial.opacity).toBe(1);
  expect(initial.activeBodies).toBe(0);expect(initial.lives).toBe(1);
  const middle=await page.evaluate(()=>{
   const p=(window as any).deathPreview;for(let i=0;i<10;i++)p.lab.step(p.empty());p.renderer.render(p.lab,1,.02,true);
   const effect=p.renderer.dissolves.get(p.dead.id),positions=effect.root.geometry.getAttribute('position').array;
   return {opacity:effect.root.material.opacity,moved:positions.some((v:number,i:number)=>Math.abs(v-p.initialPositions[i])>.02),
    solidVisible:p.renderer.characters.get(p.dead.id).root.visible,replaced:p.lab.players[0].actor.id!==p.dead.id};
  });
  expect(middle.opacity).toBeGreaterThan(0);expect(middle.opacity).toBeLessThan(1);expect(middle.moved).toBe(true);
  expect(middle.solidVisible).toBe(false);expect(middle.replaced).toBe(false);
  await page.screenshot({path:testInfo.outputPath(`${model}-dissolving.png`)});
  const lifecycle=await page.evaluate(()=>{
   const p=(window as any).deathPreview;let emptyStage=false,overlap=false;
   for(let i=0;i<25;i++) {
    p.lab.step(p.empty());p.renderer.render(p.lab,1,.02,true);
    const replaced=p.lab.players[0].actor.id!==p.dead.id;
    emptyStage ||= p.dead.removed&&!replaced&&!p.renderer.characters.has(p.dead.id)&&!p.renderer.dissolves.has(p.dead.id);
    overlap ||= replaced&&(p.renderer.characters.has(p.dead.id)||p.renderer.dissolves.has(p.dead.id));
   }
   return {emptyStage,overlap,replaced:p.lab.players[0].actor.id!==p.dead.id,health:p.lab.players[0].actor.health,
    visible:p.renderer.characters.get(p.lab.players[0].actor.id).root.visible,effects:p.renderer.dissolves.size};
  });
  expect(lifecycle).toEqual({emptyStage:true,overlap:false,replaced:true,health:100,visible:true,effects:0});
  await page.screenshot({path:testInfo.outputPath(`${model}-respawned.png`)});
  await page.evaluate(()=>{const p=(window as any).deathPreview;p.renderer.dispose();p.lab.dispose();p.container.remove();delete (window as any).deathPreview;});
 }
});
