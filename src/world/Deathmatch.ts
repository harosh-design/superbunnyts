import type { Actor } from './Actor';

export const MATCH_RULES = {
  lives: 10, respawnDelay: 0.6, deathDissolveDuration: 0.45, countdown: 3, resultsLockout: 1.5,
  maxHealth: 100, minHeadImpactSpeed: 2, damagePerJoule: 2, headHitCooldown: 0.25
} as const;

/** Impact energy estimate above the harmless contact speed, in health points. */
export function headImpactDamage(speed: number, impulse: number): number {
  return Math.min(MATCH_RULES.maxHealth, 0.5 * Math.max(0, speed - MATCH_RULES.minHeadImpactSpeed)
    * Math.max(0, impulse) * MATCH_RULES.damagePerJoule);
}
export interface PlayerSlot { index: number; lives: number; kills: number; actor: Actor; respawnAt: number }
export interface MatchOptions { players?: number; lives?: number; model?: 'bunny' | 'sumo'; menu?: boolean }

export class Deathmatch {
  phase: 'countdown' | 'playing' | 'results' = 'countdown';
  winner: number | null = null;
  resultsSince = -Infinity;
  lastCountdown = 4;
  restartRequested = false;
  constructor(readonly players: PlayerSlot[], readonly options: MatchOptions) {}
}
