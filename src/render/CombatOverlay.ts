import { Vector3, type Camera } from 'three';
import type { PhysicsLab } from '../world/PhysicsLab';
import { PLAYER_COLORS } from '../world/Actor';
import type { CharacterVisual } from './CharacterVisual';
import { MATCH_RULES } from '../world/Deathmatch';

/** Screen-sized labels projected from world positions; all motion uses game time. */
export class CombatOverlay {
  readonly root = document.createElement('div');
  private readonly bars = new Map<number, HTMLElement>();
  private readonly seen = new Map<number, number>();
  private readonly numbers: { node: HTMLElement; at: number; x: number; y: number; drift: number }[] = [];
  private readonly point = new Vector3();

  constructor(container: HTMLElement) {
    this.root.className = 'combat-overlay'; container.append(this.root);
  }

  update(lab: PhysicsLab, camera: Camera, characters: ReadonlyMap<number, CharacterVisual>, time: number, width: number, height: number): void {
    for (const [id, node] of this.bars) if (!lab.actors.some(a => a.id === id)) {
      node.remove(); this.bars.delete(id); this.seen.delete(id);
    }
    for (const actor of lab.actors) {
      let bar = this.bars.get(actor.id);
      if (!bar) {
        bar = document.createElement('div'); bar.className = 'overhead-health';
        bar.style.setProperty('--player-color', PLAYER_COLORS[actor.player]);
        bar.innerHTML = `<span class="overhead-player">P${actor.player + 1}</span><div class="overhead-track" role="progressbar" aria-label="Здоровье P${actor.player + 1}" aria-valuemin="0" aria-valuemax="${MATCH_RULES.maxHealth}"><i></i></div>`;
        this.root.append(bar); this.bars.set(actor.id, bar);
      }
      bar.hidden = !actor.alive || !!lab.options.menu;
      const anchor = characters.get(actor.id)!.overheadAnchor;
      this.place(bar, anchor.x, anchor.y, camera, width, height);
      const track = bar.querySelector<HTMLElement>('.overhead-track')!;
      track.setAttribute('aria-valuenow', String(Math.ceil(actor.health)));
      track.setAttribute('aria-valuetext', `${Math.ceil(actor.health)} из ${MATCH_RULES.maxHealth}`);
      track.firstElementChild!.setAttribute('style', `width:${actor.health / MATCH_RULES.maxHealth * 100}%`);
      bar.classList.toggle('is-hurt', time - actor.lastHurtAt < 0.25);
      bar.classList.toggle('is-low', actor.health <= 25);
      for (const hit of actor.damageHits) if (hit.id > (this.seen.get(actor.id) ?? 0)) {
        this.seen.set(actor.id, hit.id);
        if (time - hit.at > 0.95 || lab.options.menu) continue;
        const node = document.createElement('div'); node.className = 'damage-number';
        node.classList.toggle('heavy-hit', hit.amount >= 25);
        node.textContent = `−${Math.max(1, Math.round(hit.amount))}`;
        node.dataset.player = String(actor.player + 1);
        const spark = document.createElement('i'); node.append(spark); this.root.append(node);
        this.numbers.push({ node, at: hit.at, x: hit.x, y: hit.y, drift: (hit.id % 2 ? -1 : 1) * 0.25 });
      }
    }
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const hit = this.numbers[i], age = Math.max(0, time - hit.at), t = age / 0.95;
      if (t >= 1) { hit.node.remove(); this.numbers.splice(i, 1); continue; }
      const scale = 1 + 0.45 * Math.max(0, 1 - age / 0.16);
      this.place(hit.node, hit.x + hit.drift * t, hit.y + 0.85 * t, camera, width, height, scale);
      hit.node.style.opacity = String(Math.min(1, (1 - t) / 0.35));
      const spark = hit.node.firstElementChild as HTMLElement;
      spark.style.opacity = String(Math.max(0, 1 - age / 0.2));
      spark.style.transform = `translate(-50%, -50%) scale(${0.5 + age * 6}) rotate(15deg)`;
    }
  }

  private place(node: HTMLElement, x: number, y: number, camera: Camera, width: number, height: number, scale = 1): void {
    this.point.set(x, y, 0).project(camera);
    node.style.visibility = Math.abs(this.point.z) > 1 ? 'hidden' : '';
    node.style.left = `${(this.point.x + 1) * width / 2}px`;
    node.style.top = `${(1 - this.point.y) * height / 2}px`;
    node.style.transform = `translate(-50%, -100%) scale(${scale})`;
  }

  reset(): void {
    this.root.replaceChildren(); this.bars.clear(); this.seen.clear(); this.numbers.length = 0;
  }
  dispose(): void { this.reset(); this.root.remove(); }
}
