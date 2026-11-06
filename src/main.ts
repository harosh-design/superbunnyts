import { tuning } from './config/bunnyTuning';
import { PLAYER_COLORS } from './world/Actor';
import { type MatchOptions } from './world/Deathmatch';
import { emptyInputFrame } from './input/InputFrame';
import { KeyboardInput } from './input/KeyboardInput';
import { SceneRenderer } from './render/SceneRenderer';
import { PhysicsLab } from './world/PhysicsLab';
import { SCENES, type SceneId } from './world/Environment';
import { GameAudio } from './audio/GameAudio';
import { MAX_REPLAY_TICKS, newReplay, readReplay, type Replay } from './debug/Replay';
import './ui/styles.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
const options = Object.entries(SCENES).map(([id, name]) => `<option value="${id}">${name}</option>`).join('');
app.innerHTML = `
  <div class="scene"></div>
  <div class="hud">
    <header class="topbar">
      <div><div class="eyebrow">Physics playground · 01</div><h1>Super Bunny</h1><p class="subtitle">Physics Lab</p></div>
      <div class="actions">
        <button class="action" id="menu" type="button">Меню <kbd>Q</kbd></button>
        <button class="action" id="mute" type="button" aria-pressed="false">Звук: вкл.</button>
        <button class="action" id="reset" type="button">Сбросить <kbd>R</kbd></button>
        <button class="action" id="pause" type="button">Пауза <kbd>Esc</kbd></button>
      </div>
    </header>
    <div class="toast" role="status" hidden></div>
    <footer class="footer">
      <div class="controls">
        <div class="control"><span class="keys"><kbd>A</kbd><kbd>D</kbd></span><span>Перекат</span></div>
        <div class="control"><span class="keys"><kbd>W</kbd></span><span>Прыжок</span></div>
        <div class="control"><span class="keys"><kbd>Space</kbd></span><span>Держать захват</span></div>
      </div>
      <div class="status"><div class="state" data-state="air">В ВОЗДУХЕ</div><div><span id="ticks">0</span> тактов · 50 Гц · руки <span id="grips">0/2</span></div></div>
    </footer>
    <div id="scoreboard" class="scoreboard" hidden></div>
    <div id="match-banner" class="match-banner" aria-live="polite" hidden></div>
    <section id="results" class="results" hidden><div class="eyebrow">Матч завершён</div><h2 id="winner"></h2><div id="results-scores"></div><button class="primary" id="rematch" type="button">Реванш</button><p>Или нажми прыжок</p></section>
    <details class="tools"><summary>Инструменты</summary><div class="tool-body">
      <label>Сцена<select id="scene-select">${options}</select></label>
      <label class="check"><input id="debug" type="checkbox"> Физические формы и контакты</label>
      <label class="check"><input id="fixed-camera" type="checkbox"> Фиксированная камера</label>
      <div class="tool-actions"><button id="record" type="button">Записать</button><button id="replay" type="button" disabled>Повторить</button></div>
      <div class="tool-actions"><button id="download" type="button" disabled>Скачать JSON</button><label class="file-label">Загрузить JSON<input id="upload" type="file" accept=".json,application/json"></label></div>
      <output id="replay-status">Запись до 5 минут</output><output id="physics-status">Отброшено времени: 0 мс</output>
    </div></details>
  </div>
  <div class="overlay" id="pause-overlay" hidden><section class="pause-card" role="dialog" aria-modal="true" aria-labelledby="pause-title">
    <div class="eyebrow">Super Bunny</div><h2 id="pause-title">Пауза</h2><p>Продолжить — Esc.<br>Начать заново — R. В меню — Q.</p>
    <button class="primary" id="resume" type="button">Продолжить</button>
  </section></div>
  <div class="overlay menu-overlay" id="start-overlay"><section class="pause-card start-card" role="dialog" aria-modal="true" aria-labelledby="start-title">
    <div class="eyebrow">Super Bunny · Browser edition</div><h2 id="start-title">Super Bunny</h2>
    <p>Бей соперников в голову: сильнее удар — больше урон. 100 HP на каждую жизнь. Последний выживший побеждает.</p>
    <div class="match-options">
      <label>Арена<select id="match-map"><option value="dm-flat">Flat</option><option value="dm-meadow">Meadow</option></select></label>
      <label>Игроки<select id="player-count"><option>2</option><option>3</option><option>4</option></select></label>
      <label>Жизни<select id="match-lives"><option>10</option><option>5</option><option>3</option><option>1</option></select></label>
      <label>Персонаж P1<select id="player-model"><option value="bunny">Bunny</option><option value="sumo">Sumo</option></select></label>
    </div>
    <button class="primary" id="start" type="button">Deathmatch · Enter</button>
    <div class="menu-bindings"><div><b>P1</b> W · A/D · Space</div><div><b>P2</b> ↑ · ←/→ · Right Shift</div><div><b>P3</b> U · H/K · V</div><div><b>P4</b> Num 8 · 4/6 · 0</div></div>
    <details class="lab-menu"><summary>Одиночная лаборатория</summary><label class="scene-label" for="start-scene">Сцена</label><select id="start-scene">${Object.entries(SCENES).filter(([id]) => !id.startsWith('dm-')).map(([id,name]) => `<option value="${id}">${name}</option>`).join('')}</select><button class="secondary" id="start-lab" type="button">Physics Lab · T</button></details>
  </section></div>`;

function element<T extends HTMLElement = HTMLElement>(selector: string): T { return app.querySelector<T>(selector)!; }

async function start(): Promise<() => void> {
  let lab = new PhysicsLab('dm-flat', undefined, { menu: true, players: 2 });
  const renderer = await SceneRenderer.create(element('.scene'), lab);
  const audio = new GameAudio();
  let mode: 'menu' | 'playing' | 'paused' = 'menu';
  let accumulator = 0, lastFrame: number | null = null, animation = 0, noticeUntil = 0, dropped = 0;
  let snapCamera = true, contextLost = false;
  let recording: Replay | null = null, saved: Replay | null = null, playback: Replay | null = null, playbackIndex = 0;
  const overlay = element('#pause-overlay'), menuOverlay = element('#start-overlay'), hud = element('.hud');
  const resume = element<HTMLButtonElement>('#resume'), startButton = element<HTMLButtonElement>('#start');
  const sceneSelect = element<HTMLSelectElement>('#scene-select'), startScene = element<HTMLSelectElement>('#start-scene');
  const labControls = element('.controls').innerHTML;
  const state = element('.state'), ticks = element('#ticks'), toast = element('.toast');
  const listeners: (() => void)[] = [];
  const on = (selector: string, event: string, listener: (event: Event) => void) => {
    const node = element(selector);
    const handler = (e: Event) => {
      listener(e);
      if (event === 'click' && node instanceof HTMLButtonElement) node.blur();
      if (event === 'change' && (node instanceof HTMLSelectElement || node instanceof HTMLInputElement && node.type === 'checkbox')) node.blur();
    };
    node.addEventListener(event, handler); listeners.push(() => node.removeEventListener(event, handler));
  };
  const input = new KeyboardInput({
    onAction: code => {
      if (code === 'KeyQ') toMenu();
      if (code === 'KeyT' && mode === 'menu') beginLab();
      if (mode === 'menu' && ['Enter', 'KeyW', 'ArrowUp', 'Space'].includes(code)) beginMatch();
      if (code === 'KeyM' && mode !== 'menu') toggleMute();
      if (code === 'KeyR' && mode !== 'menu') reset();
      if (code === 'Escape' && mode !== 'menu') setMode(mode === 'paused' ? 'playing' : 'paused');
    },
    onFocusLost: () => { if (mode === 'playing') setMode('paused'); }
  });

  function notice(message: string): void { toast.textContent = message; toast.hidden = false; noticeUntil = performance.now() + 3500; }
  function updateReplay(): void {
    element<HTMLButtonElement>('#record').textContent = recording ? 'Остановить запись' : 'Записать';
    element<HTMLButtonElement>('#replay').disabled = !saved;
    element<HTMLButtonElement>('#download').disabled = !saved;
    element('#replay-status').textContent = playback ? `Повтор: ${playbackIndex}/${playback.frames.length}`
      : recording ? `Запись: ${recording.frames.length}/${MAX_REPLAY_TICKS}` : saved ? `Сохранено ${saved.frames.length} тактов` : 'Запись до 5 минут';
  }
  function finishRecording(): void { if (recording?.frames.length) saved = recording; recording = null; updateReplay(); }
  function setMode(value: typeof mode): void {
    if (contextLost && value === 'playing') return;
    mode = value; accumulator = 0; lastFrame = null; input.clear();
    overlay.hidden = value !== 'paused'; menuOverlay.hidden = value !== 'menu'; hud.inert = value !== 'playing';
    audio.setPaused(value !== 'playing');
    if (value === 'paused') resume.focus({ preventScroll: true });
    else if (value === 'menu') startButton.focus({ preventScroll: true });
    else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }
  function selectedOptions(): MatchOptions {
    return { players: Number(element<HTMLSelectElement>('#player-count').value), lives: Number(element<HTMLSelectElement>('#match-lives').value), model: element<HTMLSelectElement>('#player-model').value as 'bunny' | 'sumo' };
  }
  function replace(scene: SceneId, settings = selectedOptions()): void {
    lab.dispose(); lab = new PhysicsLab(scene, undefined, settings); renderer.resetCharacter(lab);
    sceneSelect.value = scene; if (!scene.startsWith('dm-')) startScene.value = scene; element('.subtitle').textContent = SCENES[scene];
    element('.controls').innerHTML = lab.match ? ['W · A/D · Space', '↑ · ←/→ · R-Shift', 'U · H/K · V', 'Num 8 · 4/6 · 0'].slice(0, lab.players.length).map((keys, i) => `<span class="match-control"><b style="color:${PLAYER_COLORS[i]}">P${i + 1}</b> ${keys}</span>`).join('') : labControls;
    audio.reset(); dropped = 0; snapCamera = true; accumulator = 0; lastFrame = null; input.clear();
  }
  function begin(scene: SceneId): void { finishRecording(); playback = null; replace(scene); setMode('playing'); void audio.unlock().then(() => audio.confirm()); }
  function beginMatch(): void { begin(element<HTMLSelectElement>('#match-map').value as SceneId); }
  function beginLab(): void { begin(startScene.value as SceneId); }
  function toMenu(): void { finishRecording(); playback = null; replace('dm-flat', { ...selectedOptions(), menu: true, players: 2 }); setMode('menu'); updateReplay(); }
  function reset(reason?: 'bounds' | 'invalid'): void {
    finishRecording(); playback = null; replace(lab.scene, lab.options); setMode('playing');
    if (reason) {
      notice(reason === 'invalid' ? 'Ошибка физики: сцена восстановлена' : 'За пределами сцены — новый старт');
      if (reason === 'invalid') console.error('Non-finite physics state; lab restored.');
    } else toast.hidden = true;
    updateReplay();
  }

  function updateMatchHud(): void {
    const match = lab.match, board = element('#scoreboard'), banner = element('#match-banner'), results = element('#results');
    board.hidden = !match; banner.hidden = !match || match.phase === 'results'; results.hidden = !match || match.phase !== 'results';
    if (!match) return;
    board.innerHTML = lab.players.map(p => {
      const hurt = lab.time - p.actor.lastHurtAt < 0.25;
      return `<div class="player-badge${hurt ? ' hurt' : ''}" style="--player-color:${PLAYER_COLORS[p.index]}"><b>P${p.index + 1}</b><strong title="Осталось жизней">×${p.lives}</strong><span>${p.kills} KO${p.respawnAt > 0 && !p.actor.alive ? ' · возрождение' : p.lives === 0 ? ' · выбыл' : ''}</span></div>`;
    }).join('');
    const countdown = 3 - lab.time;
    banner.textContent = match.phase === 'countdown' ? String(Math.max(1, Math.ceil(countdown))) : countdown > -0.8 ? 'ВПЕРЁД!' : '';
    if (match.phase === 'results') {
      element('#winner').textContent = match.winner === null ? 'Ничья!' : `P${match.winner + 1} побеждает!`;
      element('#winner').style.color = match.winner === null ? '#fff' : PLAYER_COLORS[match.winner];
      element('#results-scores').textContent = lab.players.map(p => `P${p.index + 1}: ${p.kills} KO`).join(' · ');
      element<HTMLButtonElement>('#rematch').disabled = lab.time - match.resultsSince < 1.5;
    }
  }
  on('#rematch', 'click', () => { if (lab.match && lab.time - lab.match.resultsSince >= 1.5) reset(); });

  function frame(now: number): void {
    const elapsed = lastFrame === null ? 0 : Math.max(0, (now - lastFrame) / 1000); lastFrame = now;
    if (mode === 'playing' || mode === 'menu') {
      const allowed = Math.min(elapsed, 0.16); dropped += elapsed - allowed; accumulator += allowed;
      let steps = 0;
      while (accumulator + 1e-10 >= tuning.dt && steps < 8) {
        if (playback && playbackIndex >= playback.frames.length) { playback = null; setMode('paused'); updateReplay(); break; }
        const controls = mode === 'menu' ? lab.players.map((_, i) => {
          const period = 110 + i * 27, phase = lab.ticks % period;
          return { ...emptyInputFrame(), jumpPressed: phase === 70 };
        }) : playback ? playback.frames[playbackIndex++] : input.pollAll();
        renderer.fixedUpdate(lab);
        const recovery = lab.step(controls);
        if (recording && !recovery) recording.frames.push(controls.map(c => ({ ...c })));
        if (mode === 'playing') audio.step(lab); accumulator = Math.max(0, accumulator - tuning.dt); steps++;
        if (recording && recording.frames.length >= MAX_REPLAY_TICKS) { finishRecording(); notice('Запись завершена: 5 минут'); }
        if (recovery) { reset(recovery); break; }
        if (lab.match?.restartRequested) { if (recording) recording.frames.pop(); reset(); break; }
        if (mode === 'menu' && lab.actors.some(a => Math.abs(a.current.core.x) > 7.5 || a.current.core.y < -2)) { replace('dm-flat', { ...selectedOptions(), menu: true, players: 2 }); break; }
      }
      if (steps === 8 && accumulator >= tuning.dt) { const lost = Math.floor(accumulator / tuning.dt) * tuning.dt; dropped += lost; accumulator -= lost; }
    } else input.clear();
    renderer.render(lab, mode !== 'paused' ? Math.min(1, accumulator / tuning.dt) : 1, elapsed, snapCamera, mode === 'paused');
    snapCamera = false;
    updateMatchHud();
    state.dataset.state = mode === 'paused' ? 'paused' : lab.grounded ? 'grounded' : 'air';
    state.textContent = mode === 'paused' ? 'ПАУЗА' : lab.grounded ? 'НА ЗЕМЛЕ' : 'В ВОЗДУХЕ';
    ticks.textContent = String(lab.ticks); element('#grips').textContent = `${Number(lab.grab.holding(0)) + Number(lab.grab.holding(1))}/2`;
    element('#physics-status').textContent = `Отброшено времени: ${Math.round(dropped * 1000)} мс · тела ${lab.world.getBodyCount()} · суставы ${lab.world.getJointCount()}`;
    if (recording || playback) updateReplay();
    if (!toast.hidden && now >= noticeUntil) toast.hidden = true;
    animation = requestAnimationFrame(frame);
  }

  on('#start', 'click', beginMatch); on('#start-lab', 'click', beginLab); on('#menu', 'click', toMenu); on('#reset', 'click', () => reset());
  on('#pause', 'click', () => setMode('paused')); on('#resume', 'click', () => setMode('playing'));
  on('#scene-select', 'change', () => { finishRecording(); playback = null; replace(sceneSelect.value as SceneId); updateReplay(); });
  on('#debug', 'change', () => { renderer.debug.root.visible = element<HTMLInputElement>('#debug').checked; });
  on('#fixed-camera', 'change', () => { renderer.framing.fixed = element<HTMLInputElement>('#fixed-camera').checked; snapCamera = true; });
  function muteLabel(): void { const button = element<HTMLButtonElement>('#mute'); button.textContent = audio.muted ? 'Звук: выкл.' : 'Звук: вкл.'; button.setAttribute('aria-pressed', String(audio.muted)); }
  function toggleMute(): void { audio.setMuted(!audio.muted); muteLabel(); if (!audio.muted) void audio.unlock(); }
  on('#mute', 'click', toggleMute); muteLabel();
  on('#record', 'click', () => {
    if (recording) { finishRecording(); return; }
    playback = null; replace(lab.scene, lab.options); recording = newReplay(lab.scene, lab.options); setMode('playing'); updateReplay();
  });
  on('#replay', 'click', () => {
    if (!saved) return; finishRecording(); playback = saved; playbackIndex = 0; replace(saved.scene, saved.options); setMode('playing'); updateReplay();
  });
  on('#download', 'click', () => {
    if (!saved) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(saved)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `super-bunny-${saved.scene}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  on('#upload', 'change', () => {
    const upload = element<HTMLInputElement>('#upload'), file = upload.files?.[0]; if (!file) return;
    if (file.size > 8_000_000) { notice('Файл повтора слишком большой'); upload.value = ''; return; }
    void file.text().then(text => { const loaded = readReplay(JSON.parse(text)); finishRecording(); saved = loaded; playback = null; updateReplay(); notice('Повтор загружен'); })
      .catch(error => notice(error instanceof Error ? error.message : 'Не удалось загрузить повтор')).finally(() => { upload.value = ''; });
  });
  const onContextLost = (event: Event) => {
    event.preventDefault(); contextLost = true; setMode('paused');
    element('#pause-title').textContent = 'Графика недоступна'; element('.pause-card p').textContent = 'Перезагрузите страницу, чтобы восстановить сцену.'; resume.hidden = true;
  };
  renderer.canvas.addEventListener('webglcontextlost', onContextLost);
  setMode('menu'); animation = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(animation); lab.dispose(); input.dispose(); audio.dispose(); listeners.forEach(remove => remove()); renderer.canvas.removeEventListener('webglcontextlost', onContextLost); renderer.dispose(); };
}

async function bootstrap(): Promise<void> {
  const loading = document.createElement('div'); loading.className = 'loading'; loading.setAttribute('role', 'status'); loading.textContent = 'Загрузка лаборатории…'; app.append(loading);
  try {
    if (!document.createElement('canvas').getContext('webgl2')) throw new Error('WebGL 2 unavailable');
    const dispose = await start(); loading.remove(); if (import.meta.hot) import.meta.hot.dispose(dispose);
  } catch (error) {
    console.error(error); app.innerHTML = '<div class="error"><h1>Не удалось запустить сцену</h1><p>Проверьте загрузку ресурсов и поддержку WebGL 2, затем перезагрузите страницу.</p></div>';
  }
}
void bootstrap();
