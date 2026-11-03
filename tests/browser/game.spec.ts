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
