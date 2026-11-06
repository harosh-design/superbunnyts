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

test('health HUD follows damage and KO in a deterministic four-player replay',async({page},testInfo)=>{
 test.skip(!!process.env.BUNNY_TEST_URL,'Replay fixture generation uses Vite source modules.');
 const {replay,health,alive}=await page.evaluate(async()=>{
  const replayPath='/src/debug/Replay.ts',physicsPath='/src/world/PhysicsLab.ts';
  const [{newReplay},{PhysicsLab}]=await Promise.all([import(replayPath),import(physicsPath)]);
  const replay=newReplay('dm-flat',{players:4}),lab=new PhysicsLab('dm-flat',undefined,replay.options);
  let seed=17;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<600;i++) {
   const frames=Array.from({length:4},()=>({roll:random()<.3?-1:random()<.5?1:0,jumpPressed:random()<.08,grabHeld:random()<.6,jumpHeld:false}));
   replay.frames.push(frames);lab.step(frames);
   if(lab.players.some((p:any)=>p.actor.alive&&p.actor.health<99))break;
  }
  return {replay,health:lab.players.map((p:any)=>Math.ceil(p.actor.health)),alive:lab.players.map((p:any)=>p.actor.alive)};
 });
 expect(health.some((hp:number)=>hp<100)).toBe(true);
 await page.locator('#start').click();await page.locator('.tools summary').click();
 await page.locator('#upload').setInputFiles({name:'combat.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(replay))});
 await expect(page.locator('.toast')).toHaveText('Повтор загружен');await page.locator('#replay').click();
 await expect(page.locator('#pause-overlay')).toBeVisible({timeout:20000});
 for(let i=0;i<4;i++) {
  const bar=page.getByRole('progressbar',{name:`Здоровье P${i+1}`});
  if(alive[i])await expect(bar).toHaveAttribute('aria-valuenow',String(health[i]));else await expect(bar).toHaveCount(0);
 }
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

test('Bunny and Sumo linger, sink through the ground and finish before respawning',async({page},testInfo)=>{
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
   const visual=renderer.characters.get(dead.id);
   (window as any).deathPreview={lab,renderer,container,dead,empty,startY:visual.root.position.y};
   return {solidVisible:visual.root.visible,y:visual.root.position.y,
    activeBodies:dead.rig.bodies.filter((b:any)=>b.isActive()).length,lives:lab.players[0].lives};
  },model);
  expect(initial.solidVisible).toBe(true);expect(initial.activeBodies).toBe(0);expect(initial.lives).toBe(1);
  const held=await page.evaluate(()=>{
   const p=(window as any).deathPreview;for(let i=0;i<25;i++)p.lab.step(p.empty());p.renderer.render(p.lab,1,.02,true);
   return {y:p.renderer.characters.get(p.dead.id).root.position.y,replaced:p.lab.players[0].actor.id!==p.dead.id};
  });
  expect(held.y).toBeCloseTo(initial.y);expect(held.replaced).toBe(false);
  const middle=await page.evaluate(()=>{
   const p=(window as any).deathPreview;for(let i=0;i<40;i++)p.lab.step(p.empty());p.renderer.render(p.lab,1,.02,true);
   const root=p.renderer.characters.get(p.dead.id).root;
   return {y:root.position.y,solidVisible:root.visible,replaced:p.lab.players[0].actor.id!==p.dead.id};
  });
  expect(middle.y).toBeLessThan(initial.y-.2);expect(middle.solidVisible).toBe(true);expect(middle.replaced).toBe(false);
  await page.screenshot({path:testInfo.outputPath(`${model}-sinking.png`)});
  const lifecycle=await page.evaluate(()=>{
   const p=(window as any).deathPreview;let emptyStage=false,overlap=false;
   for(let i=0;i<75;i++) {
    p.lab.step(p.empty());p.renderer.render(p.lab,1,.02,true);
    const replaced=p.lab.players[0].actor.id!==p.dead.id;
    emptyStage ||= p.dead.removed&&!replaced&&!p.renderer.characters.has(p.dead.id)&&!p.renderer.corpses.has(p.dead.id);
    overlap ||= replaced&&(p.renderer.characters.has(p.dead.id)||p.renderer.corpses.has(p.dead.id));
   }
   return {emptyStage,overlap,replaced:p.lab.players[0].actor.id!==p.dead.id,health:p.lab.players[0].actor.health,
    visible:p.renderer.characters.get(p.lab.players[0].actor.id).root.visible,effects:p.renderer.corpses.size};
  });
  expect(lifecycle).toEqual({emptyStage:true,overlap:false,replaced:true,health:100,visible:true,effects:0});
  await page.screenshot({path:testInfo.outputPath(`${model}-respawned.png`)});
  await page.evaluate(()=>{const p=(window as any).deathPreview;p.renderer.dispose();p.lab.dispose();p.container.remove();delete (window as any).deathPreview;});
 }
});

test('overhead bars, floating damage and physical strike pose follow real contacts and pause',async({page},testInfo)=>{
 test.skip(!!process.env.BUNNY_TEST_URL,'Contact fixtures use Vite source modules.');
 await page.locator('#start').click();await page.keyboard.press('Escape');
 for(const model of ['bunny','sumo']) {
  const hit=await page.evaluate(async(model)=>{
   const physicsPath='/src/world/PhysicsLab.ts',rendererPath='/src/render/SceneRenderer.ts';
   const [{PhysicsLab},{SceneRenderer}]=await Promise.all([import(physicsPath),import(rendererPath)]);
   const lab=new PhysicsLab('dm-flat',undefined,{players:2,model});lab.match.phase='playing';
   const attacker=lab.players[0].actor,victim=lab.players[1].actor;
   const move=(actor:any,x:number,y:number)=>{
    const origin=actor.rig.core.getPosition().clone();
    for(const body of actor.rig.bodies){const p=body.getPosition();body.setTransform({x:x+p.x-origin.x,y:y+p.y-origin.y},body.getAngle());body.setLinearVelocity({x:0,y:0});body.setAngularVelocity(0);}
    actor.motor.goLimp();actor.current=actor.previous=actor.capture();
   };
   move(victim,0,1);const head=victim.rig.core.getWorldPoint({x:-.02,y:.34});
   move(attacker,head.x-.04,head.y+.155+.055+.39-.003);
   for(const body of attacker.rig.bodies)body.setLinearVelocity({x:0,y:-8});
   const empty=()=>lab.players.map(()=>({roll:0,jumpHeld:false,jumpPressed:false,grabHeld:false}));
   // Render only after several fixed steps: transient events must survive them.
   for(let i=0;i<5;i++)lab.step(empty());
   const container=document.createElement('div');container.style.cssText='position:fixed;inset:0;z-index:100';document.body.append(container);
   const renderer=await SceneRenderer.create(container,lab);renderer.render(lab,1,.02,true);
   const visual=renderer.characters.get(attacker.id),leg=visual.legs[0].tip;
   const animated=leg.getWorldPosition(visual.root.position.clone()).clone();
   const strike=attacker.lastStrike;attacker.lastStrike=null;visual.pose(attacker.current,1,0,attacker,lab.time);
   const rest=leg.getWorldPosition(visual.root.position.clone()).clone();attacker.lastStrike=strike;
   renderer.render(lab,1,0,true);
   (window as any).combatPreview={lab,renderer,container,empty,victim};
   return {health:Math.ceil(victim.health),amount:Math.round(victim.damageHits[0].amount),animationDistance:animated.distanceTo(rest),
    numbers:container.querySelectorAll('.damage-number').length,bars:container.querySelectorAll('.overhead-health:not([hidden])').length,
    value:container.querySelector('[aria-label="Здоровье P2"]').getAttribute('aria-valuenow')};
  },model);
  expect(hit.health).toBeLessThan(100);expect(hit.numbers).toBe(1);expect(hit.bars).toBe(2);expect(hit.value).toBe(String(hit.health));expect(hit.animationDistance).toBeLessThan(.00001);
  const container=page.locator('body > div').last();
  await expect(container.locator('.damage-number')).toHaveText(`−${hit.amount}`);
  const freeze=await page.evaluate(()=>{
   const p=(window as any).combatPreview,node=p.container.querySelector('.damage-number'),before=node.getAttribute('style');
   for(let i=0;i<10;i++)p.renderer.render(p.lab,1,.02,false,true);
   return {before,after:node.getAttribute('style')};
  });
  expect(freeze.after).toBe(freeze.before);
  await page.screenshot({path:testInfo.outputPath(`${model}-combat-feedback.png`)});
  const cleanup=await page.evaluate(()=>{
   const p=(window as any).combatPreview;
   for(let i=0;i<55;i++)p.lab.step(p.empty());p.renderer.render(p.lab,1,.02,true);
   const numbers=p.container.querySelectorAll('.damage-number').length;
   p.renderer.resetCharacter(p.lab);
   const resetNumbers=p.container.querySelectorAll('.damage-number').length;
   p.renderer.dispose();p.lab.dispose();p.container.remove();delete(window as any).combatPreview;
   return {numbers,resetNumbers};
  });
  expect(cleanup).toEqual({numbers:0,resetNumbers:0});
 }
});
