import { emptyInputFrame, type InputFrame } from './InputFrame';

export const PLAYER_KEYS = [
  { jump: 'KeyW', left: 'KeyA', right: 'KeyD', grab: 'Space' },
  { jump: 'ArrowUp', left: 'ArrowLeft', right: 'ArrowRight', grab: 'ShiftRight' },
  { jump: 'KeyU', left: 'KeyH', right: 'KeyK', grab: 'KeyV' },
  { jump: 'Numpad8', left: 'Numpad4', right: 'Numpad6', grab: 'Numpad0' }
];
const GAME_CODES = new Set([...PLAYER_KEYS.flatMap(p => Object.values(p)), 'KeyR', 'Escape', 'KeyQ', 'KeyT', 'KeyM', 'Enter']);
export interface KeyboardInputOptions { onAction: (code: string) => void; onFocusLost: () => void }

export class KeyboardInput {
  private held = new Set<string>();
  private pendingJump = [false, false, false, false];
  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (!GAME_CODES.has(e.code) || isTextTarget(e.target)) return;
    if (e.target instanceof HTMLButtonElement && ['Enter', 'Space'].includes(e.code)) return;
    e.preventDefault();
    if (e.repeat || this.held.has(e.code)) return;
    this.held.add(e.code);
    PLAYER_KEYS.forEach((keys, i) => { if (e.code === keys.jump) this.pendingJump[i] = true; });
    this.options.onAction(e.code);
  };
  private readonly onKeyUp = (e: KeyboardEvent) => { this.held.delete(e.code); };
  private readonly onBlur = () => { this.clear(); this.options.onFocusLost(); };
  private readonly onVisibility = () => { if (document.hidden) this.onBlur(); };
  constructor(private readonly options: KeyboardInputOptions) {
    window.addEventListener('keydown', this.onKeyDown); window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur); document.addEventListener('visibilitychange', this.onVisibility);
  }
  clear(): void { this.held.clear(); this.pendingJump.fill(false); }
  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown); window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur); document.removeEventListener('visibilitychange', this.onVisibility); this.clear();
  }
  poll(player = 0): InputFrame {
    const frame = emptyInputFrame(), keys = PLAYER_KEYS[player];
    const left = this.held.has(keys.left), right = this.held.has(keys.right);
    frame.roll = left === right ? 0 : left ? -1 : 1;
    frame.jumpHeld = this.held.has(keys.jump); frame.grabHeld = this.held.has(keys.grab);
    frame.jumpPressed = this.pendingJump[player]; this.pendingJump[player] = false; return frame;
  }
  pollAll(): InputFrame[] { return PLAYER_KEYS.map((_, i) => this.poll(i)); }
}
function isTextTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
}
