import { EraName, EraYear } from './constants';

const Css = /* css */ `
.arena-hud { position: absolute; inset: 0; pointer-events: none; overflow: hidden; --u: 1px;
  font-family: Inter, system-ui, sans-serif; font-weight: 600; color: var(--ink); user-select: none; -webkit-user-select: none; }
.arena-hud * { box-sizing: border-box; }
.arena-hud.era-0 { --ink: #1C2612; --accent: #2E3C1E; --panel: rgba(184, 216, 106, 0.0);
  font-family: 'RetroSnake LCD', ui-monospace, monospace; font-weight: 400; -webkit-font-smoothing: none; font-smooth: never; }
.arena-hud.era-2 { --ink: #3CF6FF; --accent: #FF2EC8; font-family: Orbitron, Inter, sans-serif; font-weight: 700; }
.arena-hud.era-1 { --ink: #F5EFE6; --accent: #FFC86A; font-family: Inter, system-ui, sans-serif; font-weight: 600; }
.arena-hud.era-0 .t { text-shadow: calc(var(--u) * 3) calc(var(--u) * 3) 0 rgba(28, 38, 18, 0.18), 0 0 calc(var(--u) * 10) rgba(210, 238, 130, 0.75); }
.arena-hud.era-2 .t { text-shadow: 0 0 calc(var(--u) * 3) rgba(255, 46, 200, 0.95), 0 0 calc(var(--u) * 14) rgba(255, 46, 200, 0.55), 0 0 calc(var(--u) * 26) rgba(60, 246, 255, 0.25); }
.arena-hud.era-2 .accent.t { text-shadow: 0 0 calc(var(--u) * 3) rgba(255, 46, 200, 0.8), 0 0 calc(var(--u) * 12) rgba(255, 46, 200, 0.6); }
.arena-hud.era-1 .t { text-shadow: 0 calc(var(--u) * 2) calc(var(--u) * 6) rgba(0, 0, 0, 0.35), 0 0 calc(var(--u) * 1) rgba(0, 0, 0, 0.2); }
.arena-hud .accent { color: var(--accent); }
.ah-vignette { position: absolute; inset: 0; transition: opacity 1.2s ease; }
.ah-vignette.v0 { background: radial-gradient(ellipse at 50% 55%, rgba(0,0,0,0) 55%, rgba(28, 44, 10, 0.34) 100%); }
.ah-vignette.v1 { background: radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 60%, rgba(40, 20, 6, 0.32) 100%); }
.ah-vignette.v2 { background: radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 50%, rgba(18, 2, 34, 0.55) 100%); }
.arena-hud .fade { transition: opacity 0.25s ease; }

.ah-score { position: absolute; left: calc(var(--m) + env(safe-area-inset-left)); top: calc(var(--m) + env(safe-area-inset-top)); line-height: 1; }
.ah-label { font-size: calc(var(--u) * 22); letter-spacing: 0.12em; }
.ah-value { font-size: calc(var(--u) * 76); margin-top: calc(var(--u) * 6); font-variant-numeric: tabular-nums; }
.ah-sub { font-size: calc(var(--u) * 22); margin-top: calc(var(--u) * 12); letter-spacing: 0.06em; opacity: 0.92; white-space: pre; }
.ah-combo { margin-top: calc(var(--u) * 16); opacity: 0; transform: translateX(calc(var(--u) * -12)); transition: opacity 0.2s, transform 0.2s; }
.ah-combo.on { opacity: 1; transform: none; }
.ah-combo-text { font-size: calc(var(--u) * 32); letter-spacing: 0.04em; }
.ah-combo-bar { margin-top: calc(var(--u) * 8); width: calc(var(--u) * 260); height: calc(var(--u) * 7); background: rgba(0, 0, 0, 0.3); overflow: hidden; border-radius: calc(var(--u) * 4); }
.era-0 .ah-combo-bar { border-radius: 0; background: rgba(28, 38, 18, 0.18); }
.ah-combo-bar > i { display: block; height: 100%; width: 100%; background: var(--accent); transform-origin: left; }
.era-2 .ah-combo-bar > i { box-shadow: 0 0 calc(var(--u) * 10) var(--accent); }
.ah-combo.bump .ah-combo-text { animation: ah-bump 0.35s ease-out; }
@keyframes ah-bump { 0% { transform: scale(1.35); } 100% { transform: scale(1); } }

.ah-era { position: absolute; right: calc(var(--m) + env(safe-area-inset-right)); top: calc(var(--m) + env(safe-area-inset-top) + var(--btn) + var(--u) * 14); text-align: right; line-height: 1; }
.ah-year { font-size: calc(var(--u) * 60); }
.era-2 .ah-year { font-weight: 900; }
.ah-name { font-size: calc(var(--u) * 22); margin-top: calc(var(--u) * 10); }
.ah-portal { display: none; margin-top: calc(var(--u) * 22); padding: calc(var(--u) * 10) calc(var(--u) * 14);
  border: 1px solid currentColor; background: rgba(0, 0, 0, 0.12); font-size: max(12px, calc(var(--u) * 21));
  letter-spacing: 0.04em; line-height: 1.3; }
.ah-portal.on { display: block; }
.era-0 .ah-portal { background: rgba(184, 216, 106, 0.6); }

.ah-bonus { position: absolute; left: 50%; top: calc(var(--m) + env(safe-area-inset-top)); transform: translateX(-50%); font-size: calc(var(--u) * 30); letter-spacing: 0.08em; opacity: 0; }
.ah-bonus.on { opacity: 1; }
@media (max-aspect-ratio: 1/1) {
  .ah-bonus { left: auto; transform: none; right: calc(var(--m) + env(safe-area-inset-right)); top: calc(var(--m) + env(safe-area-inset-top) + var(--btn) + var(--u) * 230); font-size: calc(var(--u) * 26); }
  .ah-era { top: calc(var(--m) + env(safe-area-inset-top) + var(--btn) + var(--u) * 14); }
  .ah-title { top: 24%; }
}
.ah-demo { position: absolute; right: calc(var(--m) + env(safe-area-inset-right)); bottom: calc(var(--m) + env(safe-area-inset-bottom)); font-size: calc(var(--u) * 18); letter-spacing: 0.2em; opacity: 0.55; }

.ah-title { position: absolute; left: 0; right: 0; top: 17%; text-align: center; line-height: 1; }
.ah-title > div { opacity: 0; }
.ah-title-year { font-size: calc(var(--u) * 150); }
.era-2 .ah-title-year { font-weight: 900; }
.ah-title-name { font-size: calc(var(--u) * 32); margin-top: calc(var(--u) * 22); letter-spacing: 0.08em; }

.ah-center { position: absolute; left: 0; right: 0; top: 36%; text-align: center; line-height: 1.1; opacity: 0; padding: 0 5%; }
.ah-big { font-size: calc(var(--u) * 104); }
.era-2 .ah-big { font-weight: 900; }
.ah-small { font-size: calc(var(--u) * 26); margin-top: calc(var(--u) * 26); opacity: 0.85; letter-spacing: 0.04em; }
.ah-hint { position: absolute; left: 0; right: 0; bottom: calc(var(--m) + env(safe-area-inset-bottom) + var(--u) * 40); text-align: center; font-size: calc(var(--u) * 26); opacity: 0; letter-spacing: 0.04em; padding: 0 6%; }

.ah-popups { position: absolute; inset: 0; }
.ah-pop { position: absolute; left: 0; top: 0; white-space: nowrap; text-align: center; line-height: 1; will-change: transform, opacity; opacity: 0; }
.ah-pop b { display: block; font-weight: inherit; }
.ah-pop small { display: block; font-size: 0.55em; margin-top: 0.15em; }

.ah-buttons { position: absolute; right: calc(var(--m) + env(safe-area-inset-right)); top: calc(var(--m) + env(safe-area-inset-top)); display: flex; gap: calc(var(--u) * 12); }
.ah-btn { pointer-events: auto; width: var(--btn); height: var(--btn); border-radius: 50%; border: 2px solid currentColor; background: rgba(0, 0, 0, 0.18);
  color: var(--ink); display: grid; place-items: center; padding: 0; cursor: pointer; opacity: 0.8; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
.era-0 .ah-btn { border-radius: 0; background: rgba(28, 38, 18, 0.08); }
.era-2 .ah-btn { box-shadow: 0 0 10px rgba(255, 46, 200, 0.6), inset 0 0 8px rgba(60, 246, 255, 0.3); }
.ah-btn:active { transform: scale(0.92); }
.ah-btn svg { width: 55%; height: 55%; fill: currentColor; }

.ah-pause { position: absolute; inset: 0; display: none; place-items: center; background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); pointer-events: auto; color: #fff; }
.ah-pause.on { display: grid; }
.ah-gameover { position: absolute; inset: 0; display: none; place-items: center; background: rgba(28, 44, 10, 0.38); pointer-events: auto; }
.ah-gameover.on { display: grid; }
.ah-gameover-inner { text-align: center; padding: 24px; color: #1c2612; background: #cfe998; border: 3px solid #1c2612; box-shadow: 12px 12px 0 #1c2612; }
.ah-gameover-score { margin: 22px 0; font-size: max(20px, calc(var(--u) * 42)); }
.ah-pause-inner { text-align: center; }
.ah-pause .ah-big { color: #fff; }
.ah-pause-actions { display: flex; gap: calc(var(--u) * 24); justify-content: center; margin-top: calc(var(--u) * 40); flex-wrap: wrap; }
.ah-action { pointer-events: auto; font: inherit; font-size: calc(var(--u) * 30); padding: calc(var(--u) * 16) calc(var(--u) * 36); min-width: calc(var(--u) * 240);
  background: rgba(255, 255, 255, 0.08); color: #fff; border: 2px solid rgba(255, 255, 255, 0.75); border-radius: calc(var(--u) * 40); cursor: pointer; letter-spacing: 0.06em; }
.era-0 .ah-action { border-radius: 0; }
.ah-action:hover, .ah-action:focus-visible { background: rgba(255, 255, 255, 0.22); outline: none; }
.ah-action.primary { background: #fff; color: #111; }
.ah-keys { margin-top: calc(var(--u) * 26); font-size: calc(var(--u) * 20); opacity: 0.7; }

.ah-touch { position: absolute; inset: 0; display: flex; opacity: 0; transition: opacity 0.4s ease; }
.ah-touch.on { opacity: 1; }
.ah-touch > div { flex: 1; display: grid; place-items: center; border: 2px dashed rgba(255, 255, 255, 0.45); margin: 18% 3% 22%; border-radius: 24px;
  background: rgba(0, 0, 0, 0.18); color: #fff; font-size: calc(var(--u) * 34); text-align: center; line-height: 1.3; }
.era-0 .ah-touch > div { border-color: rgba(28, 38, 18, 0.5); color: #1C2612; background: rgba(28, 38, 18, 0.08); border-radius: 0; }
.ah-steer { position: absolute; left: calc(var(--m) + env(safe-area-inset-left)); right: calc(var(--m) + env(safe-area-inset-right));
  bottom: calc(18px + env(safe-area-inset-bottom)); display: none; justify-content: space-between; pointer-events: none; }
.ah-steer.on { display: flex; }
.ah-steer button { pointer-events: auto; width: 76px; height: 64px; border: 2px solid currentColor; border-radius: 16px;
  background: rgba(8, 12, 8, 0.55); color: #e8f5cf; font: 700 30px system-ui, sans-serif; touch-action: none;
  -webkit-tap-highlight-color: transparent; }
.ah-steer button:active { transform: scale(0.94); background: rgba(184,216,106,0.35); }
.era-0 .ah-steer button { border-radius: 0; color: #1c2612; background: rgba(206,231,149,0.82); }
.arena-hud.touch-controls .ah-hint { bottom: calc(var(--m) + env(safe-area-inset-bottom) + 100px); }
`;

export interface HudState {
  era: number;
  transitionTarget: number | null;
  score: number;
  length: number;
  best: number;
  combo: number;
  comboRemaining: number;
  bonusTimer: number;
  bonus: boolean;
  demo: boolean;
  state: 'wait' | 'intro' | 'playing' | 'paused' | 'dying' | 'gameover';
  stateTime: number;
  classic: boolean;
  touch: boolean;
  bannerAge: number;
  showControlsHint: boolean;
}

export interface Popup {
  x: number;
  y: number;
  visible: boolean;
  text: string;
  combo: number;
  age: number;
}

const ComboColors = ['#FFFFFF', '#FFE06A', '#FFA03A', '#FF4E8A', '#C06AFF'];

const IconPause = '<svg viewBox="0 0 24 24"><rect x="5" y="4" width="5" height="16"/><rect x="14" y="4" width="5" height="16"/></svg>';
const IconCamera =
  '<svg viewBox="0 0 24 24"><path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zm8 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/></svg>';

/** The arena's HTML HUD (AArenaHUD): era-styled score, combo meter, era badge and title card, popups, pause menu, touch UI. */
export class Hud {
  readonly root: HTMLDivElement;
  onPause: (() => void) | null = null;
  onCamera: (() => void) | null = null;
  onResume: (() => void) | null = null;
  onEndRun: (() => void) | null = null;
  onRetry: (() => void) | null = null;
  onTurnLeft: (() => void) | null = null;
  onTurnRight: (() => void) | null = null;

  private el: Record<string, HTMLElement> = {};
  private pops: HTMLDivElement[] = [];
  private last = new Map<string, string>();
  private era = -1;
  private lastCombo = 1;
  private lastScore = -1;
  private lastLength = -1;
  private lastBest = -1;
  private style: HTMLStyleElement;
  private touchHintUntil = 0;

  constructor(parent: HTMLElement) {
    this.style = document.createElement('style');
    this.style.textContent = Css;
    document.head.append(this.style);
    this.root = document.createElement('div');
    this.root.className = 'arena-hud era-0';
    this.root.innerHTML = `
      <div class="ah-vignette v0" data-k="v0"></div><div class="ah-vignette v1" data-k="v1"></div><div class="ah-vignette v2" data-k="v2"></div>
      <div class="ah-score">
        <div class="ah-label accent t" data-k="label">SCORE</div>
        <div class="ah-value t" data-k="score">0</div>
        <div class="ah-sub t" data-k="sub"></div>
        <div class="ah-combo" data-k="combo"><div class="ah-combo-text accent t" data-k="comboText"></div><div class="ah-combo-bar"><i data-k="comboBar"></i></div></div>
      </div>
      <div class="ah-buttons">
        <button class="ah-btn" data-ui data-k="cam" aria-label="Toggle camera">${IconCamera}</button>
        <button class="ah-btn" data-ui data-k="pause" aria-label="Pause">${IconPause}</button>
      </div>
      <div class="ah-era"><div class="ah-year t" data-k="year"></div><div class="ah-name accent t" data-k="name"></div><div class="ah-portal t" data-k="portal" aria-live="polite"></div></div>
      <div class="ah-bonus accent t" data-k="bonus"></div>
      <div class="ah-demo t" data-k="demo">DEMO</div>
      <div class="ah-popups" data-k="pops"></div>
      <div class="ah-title"><div class="ah-title-year t" data-k="titleYear"></div><div class="ah-title-name accent t" data-k="titleName"></div></div>
      <div class="ah-center" data-k="center"><div class="ah-big t" data-k="big"></div><div class="ah-small t" data-k="small"></div></div>
      <div class="ah-hint t" data-k="hint"></div>
      <div class="ah-touch" data-k="touch"><div>&larr;<br>TAP TO<br>TURN LEFT</div><div>&rarr;<br>TAP TO<br>TURN RIGHT</div></div>
      <div class="ah-steer" data-k="steer"><button type="button" data-ui data-k="turnLeft" aria-label="Turn left">↶</button><button type="button" data-ui data-k="turnRight" aria-label="Turn right">↷</button></div>
      <div class="ah-pause" data-ui data-k="pauseMenu"><div class="ah-pause-inner">
        <div class="ah-big t">PAUSED</div>
        <div class="ah-pause-actions">
          <button class="ah-action primary" data-ui data-k="resume">RESUME</button>
          <button class="ah-action" data-ui data-k="end">END RUN</button>
        </div>
        <div class="ah-keys" data-k="keys">ESC resume &nbsp;&middot;&nbsp; ENTER end run</div>
      </div></div>
      <div class="ah-gameover" data-ui data-k="gameoverMenu"><div class="ah-gameover-inner">
        <div class="ah-big">GAME OVER</div>
        <div class="ah-gameover-score" data-k="finalScore"></div>
        <button class="ah-action primary" data-ui data-k="retry">PLAY AGAIN</button>
      </div></div>`;
    for (const node of this.root.querySelectorAll<HTMLElement>('[data-k]')) this.el[node.dataset.k!] = node;
    for (let i = 0; i < 12; ++i) {
      const pop = document.createElement('div');
      pop.className = 'ah-pop t';
      this.el.pops.append(pop);
      this.pops.push(pop);
    }
    const click = (key: string, fn: () => (() => void) | null) => {
      this.el[key].addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn()?.();
      });
    };
    click('pause', () => this.onPause);
    click('cam', () => this.onCamera);
    click('resume', () => this.onResume);
    click('end', () => this.onEndRun);
    click('retry', () => this.onRetry);
    for (const [key, callback] of [['turnLeft', () => this.onTurnLeft], ['turnRight', () => this.onTurnRight]] as const) {
      let suppressClick = false;
      this.el[key].addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        suppressClick = true;
        callback()?.();
      });
      this.el[key].addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.detail !== 0 && suppressClick) { suppressClick = false; return; }
        callback()?.();
      });
    }
    parent.append(this.root);
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  private resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const u = Math.max(0.5, Math.min(h / 1080, w / 700));
    this.root.style.setProperty('--u', `${u}px`);
    this.root.style.setProperty('--m', `${Math.round(Math.max(14, 56 * u))}px`);
    this.root.style.setProperty('--btn', `${Math.round(Math.max(40, 56 * u))}px`);
  };

  private text(key: string, value: string): void {
    if (this.last.get(key) === value) return;
    this.last.set(key, value);
    this.el[key].textContent = value;
  }

  private opacity(key: string, value: number): void {
    const v = value <= 0.005 ? '0' : value >= 0.995 ? '1' : value.toFixed(3);
    const k = `o:${key}`;
    if (this.last.get(k) === v) return;
    this.last.set(k, v);
    this.el[key].style.opacity = v;
  }

  /** One-time "tap left/right" teaching overlay. */
  showTouchHint(seconds: number, now: number): void {
    this.touchHintUntil = now + seconds;
  }

  hideTouchHint(): void {
    this.touchHintUntil = 0;
  }

  update(s: HudState, pops: readonly Popup[], now: number): void {
    if (s.era !== this.era) {
      this.era = s.era;
      this.root.className = `arena-hud era-${s.era}`;
      this.text('year', EraYear[s.era]);
      this.text('name', EraName[s.era]);
      for (let e = 0; e < 3; ++e) this.el[`v${e}`].style.opacity = e === s.era ? '1' : '0';
    }
    const best = Math.max(s.best, s.score);
    if (s.score !== this.lastScore || s.length !== this.lastLength || best !== this.lastBest) {
      this.lastScore = s.score;
      this.lastLength = s.length;
      this.lastBest = best;
      this.text('score', String(s.score));
      this.text('sub', `LENGTH ${s.length}   BEST ${best}`);
    }
    const comboOn = s.combo > 1;
    this.el.combo.classList.toggle('on', comboOn);
    if (comboOn) {
      this.text('comboText', `x${s.combo} COMBO`);
      this.el.comboBar.style.transform = `scaleX(${s.comboRemaining.toFixed(3)})`;
      if (s.combo > this.lastCombo) {
        this.el.combo.classList.remove('bump');
        void this.el.combo.offsetWidth;
        this.el.combo.classList.add('bump');
      }
    }
    this.lastCombo = s.combo;
    const portalVisible = s.transitionTarget !== null && s.state === 'playing';
    this.el.portal.classList.toggle('on', portalVisible);
    if (portalVisible) this.text('portal', `COLLECT PORTAL → ${EraYear[s.transitionTarget!]}`);
    this.el.bonus.classList.toggle('on', s.bonus);
    if (s.bonus) this.text('bonus', `BONUS  ${s.bonusTimer}`);
    this.el.demo.style.display = s.demo ? '' : 'none';
    this.el.pauseMenu.classList.toggle('on', s.state === 'paused');
    this.el.gameoverMenu.classList.toggle('on', s.state === 'gameover');
    if (s.state === 'gameover') this.text('finalScore', `SCORE ${s.score}  ·  BEST ${best}`);
    this.text('keys', s.touch ? 'tap RESUME to keep going' : 'ESC resume  ·  ENTER end run');

    // Era title card: 0.3 s in, 1.2 s hold, 0.5 s out.
    const b = s.bannerAge;
    const titleAlpha = b >= 0 && b < 2 ? Math.min(1, b / 0.3) * Math.min(1, (2 - b) / 0.5) : 0;
    this.opacity('titleYear', titleAlpha);
    this.opacity('titleName', titleAlpha);
    if (titleAlpha > 0) {
      this.text('titleYear', EraYear[s.era]);
      this.text('titleName', EraName[s.era]);
      const scale = 1 + 0.12 * Math.max(0, 1 - b / 0.4);
      this.el.titleYear.style.transform = `scale(${scale.toFixed(3)})`;
    }

    const turnHint = s.touch
      ? s.classic
        ? 'SWIPE TO STEER'
        : 'TAP LEFT / RIGHT TO TURN  ·  OR SWIPE'
      : s.classic
        ? 'ARROWS  steer      V  chase camera      ESC  pause'
        : '←  →  turn      V  classic camera      ESC  pause';
    let center = 0;
    if (s.state === 'intro' || s.state === 'wait') {
      this.text('big', 'GET READY');
      this.text('small', turnHint);
      center = Math.min(1, s.stateTime / 0.6);
    } else if (s.state === 'dying') {
      this.text('big', 'GAME OVER');
      this.text('small', '');
      center = Math.min(1, s.stateTime / 0.5);
    }
    this.opacity('center', center);
    this.text('hint', turnHint);
    this.opacity('hint', s.showControlsHint ? 0.85 : 0);
    this.el.touch.classList.toggle('on', now < this.touchHintUntil && s.state === 'playing' && !s.classic);
    const touchControls = s.touch && s.state === 'playing' && !s.demo && !s.classic;
    this.el.steer.classList.toggle('on', touchControls);
    this.root.classList.toggle('touch-controls', touchControls);

    // Floating "+points".
    const u = parseFloat(this.root.style.getPropertyValue('--u')) || 1;
    for (let i = 0; i < this.pops.length; ++i) {
      const el = this.pops[i];
      const p = pops[i];
      if (!p || !p.visible) {
        if (el.style.opacity !== '0') el.style.opacity = '0';
        continue;
      }
      const alpha = Math.min(1, Math.max(0, (1.3 - p.age) / 0.5));
      const pop = 1 + 0.35 * Math.max(0, 1 - p.age * 6);
      const size = (40 + 8 * p.combo) * u;
      const html = p.combo > 1 ? `<b>${p.text}</b><small>x${p.combo}</small>` : `<b>${p.text}</b>`;
      if (el.dataset.html !== html) {
        el.dataset.html = html;
        el.innerHTML = html;
      }
      el.style.color = s.era === 0 ? '' : ComboColors[Math.min(4, Math.max(0, p.combo - 1))];
      el.style.fontSize = `${size.toFixed(1)}px`;
      el.style.opacity = alpha.toFixed(3);
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%) scale(${pop.toFixed(3)})`;
    }
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.root.remove();
    this.style.remove();
  }
}
