import type { PhysicsLab } from '../world/PhysicsLab';

const FILES = ['jump', 'grab', 'land_1', 'land_2', 'land_3', 'spring_boing', 'match_loop', 'kick', 'death_splat', 'spike_stab', 'respawn_poof', 'countdown_beep', 'countdown_go', 'win_jingle', 'ui_confirm'] as const;
type Sound = typeof FILES[number];

export class GameAudio {
  muted = new URLSearchParams(location.search).has('mute');
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<Sound, AudioBuffer>();
  private readonly voices: AudioBufferSourceNode[] = [];
  private music: AudioBufferSourceNode | null = null;
  private loading: Promise<void> | null = null;
  private paused = true;
  private disposed = false;
  private lastLand = -Infinity;

  /** Called from a keyboard or pointer gesture; audio failure never blocks the game. */
  async unlock(): Promise<void> {
    if (this.disposed) return;
    try {
      if (!this.context) {
        this.context = new AudioContext(); this.master = this.context.createGain();
        this.master.gain.value = this.muted ? 0 : 1; this.master.connect(this.context.destination);
      }
      const context = this.context;
      if (!this.paused) await context.resume();
      if (!this.loading) this.loading = Promise.all(FILES.map(async name => {
        const response = await fetch(`${import.meta.env.BASE_URL}assets/audio/${name}.wav`);
        if (!response.ok) throw new Error(`Audio unavailable: ${name}`);
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        this.buffers.set(name, buffer);
      })).then(() => { if (!this.disposed) this.startMusic(); });
      await this.loading;
      if (this.disposed) return;
      if (this.paused) await context.suspend();
    } catch (error) { console.warn('Sound unavailable; gameplay continues.', error); }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.context) this.master.gain.setValueAtTime(muted ? 0 : 1, this.context.currentTime);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (this.context) void (paused ? this.context.suspend() : this.unlock()).catch(() => {});
  }

  reset(): void {
    this.lastLand = -Infinity;
    this.voices.forEach(v => { try { v.stop(); } catch {} });
    this.voices.length = 0;
  }

  step(lab: PhysicsLab): void {
    for (let i = 0; i < lab.events.jumps; i++) this.play('jump', 0.7, 0.08);
    for (let i = 0; i < lab.events.grabbed; i++) this.play('grab', 0.6, 0.1);
    if (lab.events.spring) this.play('spring_boing', 0.8, 0.06);
    for (const cause of lab.events.deaths) {
      if (cause === 'hazard') this.play('spike_stab', 1, 0.05);
      if (cause === 'kick') this.play('kick', 1, 0.05);
      this.play('death_splat', 0.9, 0.05);
    }
    for (let i = 0; i < lab.events.respawned; i++) this.play('respawn_poof', 0.8, 0.05);
    if (lab.events.countdown !== null) this.play(lab.events.countdown > 0 ? 'countdown_beep' : 'countdown_go', 0.7, 0);
    if (lab.events.won) this.play('win_jingle', 1, 0.05);
    const impact = lab.actors.map(a => a.lastImpact).filter(i => i !== null).sort((a, b) => b.speed - a.speed)[0];
    if (impact && impact.speed >= 1.6 && lab.time - this.lastLand >= 0.06) {
      this.lastLand = lab.time;
      this.play(`land_${1 + Math.floor(Math.random() * 3)}` as Sound, Math.min(1, impact.speed / 9), 0.1);
    }
  }

  confirm(): void { this.play('ui_confirm', 1, 0); }

  private play(sound: Sound, volume: number, jitter: number): void {
    const context = this.context, buffer = this.buffers.get(sound);
    if (!context || !this.master || !buffer || this.paused || this.muted) return;
    if (this.voices.length >= 12) { const oldest = this.voices.shift()!; try { oldest.stop(); } catch {} }
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer; source.playbackRate.value = 1 + (Math.random() * 2 - 1) * jitter;
    gain.gain.value = volume * 0.8; source.connect(gain); gain.connect(this.master);
    this.voices.push(source);
    source.onended = () => { source.disconnect(); gain.disconnect(); const i = this.voices.indexOf(source); if (i >= 0) this.voices.splice(i, 1); };
    source.start();
  }

  private startMusic(): void {
    if (!this.context || !this.master || this.music) return;
    const source = this.context.createBufferSource(), gain = this.context.createGain();
    source.buffer = this.buffers.get('match_loop')!; source.loop = true; gain.gain.value = 0.35;
    source.connect(gain); gain.connect(this.master); source.start(); this.music = source;
  }

  dispose(): void { this.disposed = true; this.reset(); this.music?.stop(); void this.context?.close(); }
}
