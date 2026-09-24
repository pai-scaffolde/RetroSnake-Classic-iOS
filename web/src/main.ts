import './style.css';
import { Engine, type Quality } from './core/Engine';
import { Assets } from './core/Assets';
import { Audio } from './core/Audio';
import { Input } from './core/Input';
import { newSession, parseFlags, type AppContext, type GameScene, type SceneFactory, type SceneName } from './core/App';
import { loadSave, writeSave } from './game/SaveData';

const factories: Record<SceneName, () => Promise<SceneFactory>> = {
  arena: () => import('./arena/ArenaScene').then((m) => m.createArenaScene),
};

const base = import.meta.env.BASE_URL;

async function boot(): Promise<void> {
  const root = document.querySelector<HTMLDivElement>('#app')!;
  const canvas = document.createElement('canvas');
  canvas.id = 'view';
  const hud = document.createElement('div');
  hud.id = 'hud';
  const loader = document.querySelector<HTMLDivElement>('#loader')!;
  const bar = loader.querySelector<HTMLDivElement>('.bar > i')!;
  const status = loader.querySelector<HTMLDivElement>('.status')!;
  root.append(canvas, hud);

  if (!('gpu' in navigator) && !document.createElement('canvas').getContext('webgl2')) {
    status.textContent = 'THIS BROWSER CANNOT RUN 3D (NO WEBGPU OR WEBGL 2)';
    return;
  }

  const flags = parseFlags(location.search);
  const save = loadSave();
  // This is a focused voxel game: the overhead Classic camera is the default.
  save.classicCamera = true;
  const engine = await Engine.create(canvas, save.quality as Quality | undefined);
  const assets = await Assets.load(base);
  const audio = new Audio(assets.manifest, base);
  audio.setEnabled(save.soundOn);
  const input = new Input(canvas);
  assets.onProgress = (loaded, total) => {
    bar.style.width = `${Math.round((100 * loaded) / Math.max(1, total))}%`;
  };
  await assets.loadFonts();

  let current: GameScene | null = null;
  let switching = false;
  const ctx: AppContext = {
    engine,
    assets,
    audio,
    input,
    save,
    session: newSession(),
    flags,
    hud,
    writeSave: () => writeSave(save, flags.demo || flags.qa || flags.autoplay),
    async go(name: SceneName) {
      if (switching) return;
      switching = true;
      try {
        const next = (await factories[name]())(ctx);
        await next.load();
        current?.exit();
        current = next;
        engine.setView(next.scene, next.camera);
        next.enter();
      } finally {
        switching = false;
      }
    },
  };
  (window as unknown as { retrosnake: AppContext }).retrosnake = ctx;

  input.on((action, source) => current?.onAction(action, source));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) current?.onBlur?.();
  });
  window.addEventListener('blur', () => current?.onBlur?.());

  const fps = flags.fps ? document.createElement('div') : null;
  if (fps) {
    fps.className = 'fps';
    root.append(fps);
  }
  let fpsTimer = 0;
  engine.start((dt, time) => {
    input.update();
    current?.update(dt, time);
    if (fps && (fpsTimer += dt) > 0.5) {
      fpsTimer = 0;
      const times = engine.frameTimes;
      const avg = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length);
      fps.textContent = `${engine.backendName}  ${(1000 / avg).toFixed(0)} fps  worst ${Math.max(...times).toFixed(1)} ms`;
    }
  });

  status.textContent = 'LOADING';
  await ctx.go('arena');
  bar.style.width = '100%';

  // Browsers only allow sound after a gesture, so the first press both starts audio and the game.
  const scripted = flags.demo || flags.qa;
  if (!scripted) {
    status.textContent = input.lastSource === 'touch' || engine.isMobile ? 'TAP TO PLAY' : 'PRESS ANY KEY';
    loader.classList.add('ready');
    await new Promise<void>((resolve) => {
      const go = (event: Event) => {
        if ((event.target as HTMLElement | null)?.closest?.('a')) return; // the Scaffolde credit link
        window.removeEventListener('keydown', go);
        loader.removeEventListener('pointerup', go);
        resolve();
      };
      window.addEventListener('keydown', go);
      loader.addEventListener('pointerup', go);
    });
  }
  void audio.unlock();
  loader.classList.add('gone');
  setTimeout(() => loader.remove(), 800);
}

boot().catch((error: unknown) => {
  console.error(error);
  const status = document.querySelector('#loader .status');
  if (status) status.textContent = 'SOMETHING WENT WRONG. TRY RELOADING.';
});
