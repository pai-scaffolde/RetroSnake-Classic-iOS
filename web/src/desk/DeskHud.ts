import * as THREE from 'three/webgpu';
import type { AppContext } from '../core/App';
import type { Phone } from './Phone';

const Css = `
.desk-hud { position: absolute; inset: 0; pointer-events: none; }
.desk-hud .vignette { position: absolute; inset: 0;
  background: radial-gradient(ellipse 75% 70% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%); }
.desk-hud .back { position: absolute; left: calc(14px + env(safe-area-inset-left)); bottom: calc(14px + env(safe-area-inset-bottom));
  width: 52px; height: 52px; border-radius: 50%; border: 1.5px solid rgba(184,216,106,0.45); background: rgba(10,14,8,0.45);
  color: rgba(184,216,106,0.9); font: 20px 'RetroSnake LCD', ui-monospace, monospace; display: flex; align-items: center;
  justify-content: center; -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); touch-action: manipulation;
  transition: transform 0.08s ease, background 0.2s ease; }
.desk-hud .back:active { transform: scale(0.92); background: rgba(184,216,106,0.25); }
.desk-hud .hint { position: absolute; left: 50%; bottom: calc(18px + env(safe-area-inset-bottom)); transform: translateX(-50%);
  font: 12px 'RetroSnake LCD', ui-monospace, monospace; letter-spacing: 0.18em; color: rgba(184,216,106,0.55);
  white-space: nowrap; transition: opacity 1.2s ease; text-shadow: 0 0 8px rgba(0,0,0,0.8); }
`;

const TapPixels = 24;
const TapMs = 600;

/**
 * The desk's own HUD child: a soft vignette, a small "C" (back) button on touch devices, a keyboard hint on desktop,
 * and raycast taps/clicks on the phone's 3D keys.
 */
export class DeskHud {
  private readonly root: HTMLDivElement;
  private readonly hint: HTMLDivElement | null = null;
  private readonly vignette: HTMLDivElement;
  private readonly ctx: AppContext;
  private readonly phone: Phone;
  private readonly camera: THREE.Camera;
  private readonly onKey: (key: number) => void;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private down: { x: number; y: number; id: number; time: number } | null = null;
  private consumedAt = -1;
  private inputs = 0;
  private hintTimer = 0;

  constructor(ctx: AppContext, phone: Phone, camera: THREE.Camera, onKey: (key: number) => void) {
    this.ctx = ctx;
    this.phone = phone;
    this.camera = camera;
    this.onKey = onKey;
    this.root = document.createElement('div');
    this.root.className = 'desk-hud';
    const style = document.createElement('style');
    style.textContent = Css;
    this.vignette = document.createElement('div');
    this.vignette.className = 'vignette';
    this.root.append(style, this.vignette);

    const touch = ctx.engine.isMobile || matchMedia('(pointer: coarse)').matches;
    if (touch) {
      const back = document.createElement('button');
      back.className = 'back';
      back.type = 'button';
      back.dataset.ui = 'back';
      back.setAttribute('aria-label', 'Back');
      back.textContent = 'C';
      back.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        ctx.input.emit('back', 'touch');
      });
      this.root.append(back);
    } else if (!ctx.flags.demo && !ctx.flags.qa) {
      this.hint = document.createElement('div');
      this.hint.className = 'hint';
      this.hint.textContent = 'ARROWS MOVE   ENTER SELECT   ESC BACK';
      this.root.append(this.hint);
    }
    ctx.hud.append(this.root);
    window.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('pointerup', this.onPointerUp, true);
  }

  /** True if the tap that is about to become a "select" already pressed a 3D key. */
  consumedTap(): boolean {
    return performance.now() - this.consumedAt < 80;
  }

  noteInput(): void {
    ++this.inputs;
  }

  /** @param menus the phone shows a menu (the keyboard hint may show) @param fade the engine's full-screen fade */
  update(dt: number, menus: boolean, fade: number): void {
    // The vignette must not tint the solid backlight green we hand over to the arena.
    this.vignette.style.opacity = String(1 - fade);
    if (!this.hint) return;
    this.hintTimer += dt;
    const show = this.inputs < 6 && this.hintTimer > 2.5 && menus;
    this.hint.style.opacity = show ? '1' : '0';
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.target !== this.ctx.engine.canvas) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    this.down = { x: event.clientX, y: event.clientY, id: event.pointerId, time: performance.now() };
  };

  private onPointerUp = (event: PointerEvent): void => {
    const down = this.down;
    this.down = null;
    if (!down || down.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) >= TapPixels || performance.now() - down.time > TapMs) return;
    const rect = this.ctx.engine.canvas.getBoundingClientRect();
    this.ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const key = this.phone.pickKey(this.raycaster);
    if (key === null) return;
    this.consumedAt = performance.now();
    this.onKey(key);
  };

  dispose(): void {
    window.removeEventListener('pointerdown', this.onPointerDown, true);
    window.removeEventListener('pointerup', this.onPointerUp, true);
    this.root.remove();
  }
}
