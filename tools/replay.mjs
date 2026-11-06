import fs from 'node:fs/promises';
import { createServer } from 'vite';
if(!process.argv[2]){console.error('Usage: npm run replay -- recording.json');process.exit(2);}
const server=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
try {
 const {readReplay,runReplay}=await server.ssrLoadModule('/src/debug/Replay.ts');
 const replay=readReplay(JSON.parse(await fs.readFile(process.argv[2],'utf8'))),lab=runReplay(replay);
 console.log(JSON.stringify({scene:lab.scene,ticks:lab.ticks,phase:lab.match?.phase??'lab',winner:lab.match?.winner??null,
 players:lab.players.map(p=>({index:p.index,lives:p.lives,kills:p.kills,health:p.actor.health,alive:p.actor.alive,pose:p.actor.current})),bodies:lab.world.getBodyCount(),joints:lab.world.getJointCount()},null,2));
 lab.dispose();
}finally{await server.close();}
