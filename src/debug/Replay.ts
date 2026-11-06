import { CHARACTER_GEOMETRY_VERSION } from '../character/CharacterSkeleton';
import { unityMass } from '../config/unityMass';
import { tuning } from '../config/bunnyTuning';
import type { InputFrame } from '../input/InputFrame';
import { PhysicsLab } from '../world/PhysicsLab';
import { SCENES, type SceneId } from '../world/Environment';
import { MATCH_RULES, type MatchOptions } from '../world/Deathmatch';

const CONFIG = JSON.stringify({ tuning, rules: MATCH_RULES, mass: unityMass, geometry: CHARACTER_GEOMETRY_VERSION, port: 5 });
export const MAX_REPLAY_TICKS = 15000;
export interface Replay { version: 2; scene: SceneId; dt: number; config: string; options: MatchOptions; frames: InputFrame[][] }
export function newReplay(scene: SceneId, options: MatchOptions = {}): Replay {
  return { version: 2, scene, dt: tuning.dt, config: CONFIG, options: { players: options.players ?? 2, lives: options.lives ?? 10, model: options.model ?? 'bunny' }, frames: [] };
}
export function readReplay(value: unknown): Replay {
  if (typeof value !== 'object' || value === null) throw new Error('Неверный файл повтора');
  const r = value as Replay, o = r.options;
  if (r.version !== 2 || !Object.hasOwn(SCENES, r.scene) || r.dt !== tuning.dt || r.config !== CONFIG) throw new Error('Повтор записан для другой версии физики');
  if (!o || !Number.isInteger(o.players) || o.players! < 2 || o.players! > 4 || !Number.isInteger(o.lives) || o.lives! < 1 || o.lives! > 10 || !['bunny', 'sumo'].includes(o.model!)) throw new Error('Неверные настройки матча');
  if (!Array.isArray(r.frames) || !r.frames.length || r.frames.length > MAX_REPLAY_TICKS) throw new Error('В повторе должно быть от 1 до 15000 тактов');
  for (const tick of r.frames) {
    if (!Array.isArray(tick) || tick.length < 1 || tick.length > 4) throw new Error('Неверное число игроков в повторе');
    for (const frame of tick) if (!frame || ![-1, 0, 1].includes(frame.roll) || [frame.jumpHeld, frame.jumpPressed, frame.grabHeld].some(v => typeof v !== 'boolean')) throw new Error('Повтор содержит неверный ввод');
  }
  return { ...newReplay(r.scene, o), frames: r.frames.map(tick => tick.map(f => ({ roll: f.roll, jumpHeld: f.jumpHeld, grabHeld: f.grabHeld, jumpPressed: f.jumpPressed }))) };
}
export function runReplay(replay: Replay): PhysicsLab {
  const checked = readReplay(replay), lab = new PhysicsLab(checked.scene, undefined, checked.options);
  for (const frames of checked.frames) {
    const reason = lab.step(frames);
    if (reason) { lab.dispose(); throw new Error(`Replay recovery at tick ${lab.ticks}: ${reason}`); }
    if (lab.match?.restartRequested) throw new Error('Replay includes a rematch boundary');
  }
  return lab;
}
