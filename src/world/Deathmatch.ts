import type { Actor } from './Actor';

export const MATCH_RULES = { lives: 10, respawnDelay: 1.5, corpseLifetime: 5, countdown: 3, resultsLockout: 1.5, headImpactSpeed: 5.5, kickWindow: 0.25 } as const;
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
