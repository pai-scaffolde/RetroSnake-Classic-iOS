/**
 * Keyboard, gamepad and touch mapped onto the phone's keypad vocabulary.
 * Scenes interpret actions: the desk uses them as menu keys, the arena as steering
 * (chase camera: left/right are relative turns; classic camera: absolute directions).
 */
export type Action = 'up' | 'down' | 'left' | 'right' | 'select' | 'back' | 'camera' | 'pause';

export type InputSource = 'keyboard' | 'gamepad' | 'touch';

export type ActionHandler = (action: Action, source: InputSource) => void;

const KeyMap: Record<string, Action> = {
  ArrowUp: 'up', KeyW: 'up', Digit2: 'up', Numpad2: 'up', Numpad8: 'up',
  ArrowDown: 'down', KeyS: 'down', Digit8: 'down',
  ArrowLeft: 'left', KeyA: 'left', Digit4: 'left', Numpad4: 'left',
  ArrowRight: 'right', KeyD: 'right', Digit6: 'right', Numpad6: 'right',
  Enter: 'select', NumpadEnter: 'select', Space: 'select', Digit5: 'select', Numpad5: 'select',
  Escape: 'pause', KeyC: 'back', Backspace: 'back',
  KeyV: 'camera', Tab: 'camera',
  KeyP: 'pause',
};

// Standard gamepad mapping: 12-15 d-pad, 0 A, 1 B, 3 Y, 9 Start, 4/5 bumpers.
const PadMap: [number, Action][] = [
  [12, 'up'], [13, 'down'], [14, 'left'], [15, 'right'],
  [4, 'left'], [5, 'right'],
  [0, 'select'], [1, 'back'], [3, 'camera'], [9, 'pause'],
];

const SwipeMinPixels = 24;

export class Input {
  private handlers = new Set<ActionHandler>();
  private padState = new Map<number, boolean[]>();
  private stickLatch = new Map<number, Action | null>();
  private touchStart: { x: number; y: number; id: number; time: number; fired: boolean } | null = null;
  /** Most recent source; the HUD shows touch hints only after a touch. */
  lastSource: InputSource = 'keyboard';
  /** When set, a tap (no swipe) on the left/right half of the screen reports left/right instead of select. */
  tapZones = false;

  constructor(surface: HTMLElement) {
    window.addEventListener('keydown', this.onKey);
    surface.addEventListener('pointerdown', this.onPointerDown);
    surface.addEventListener('pointermove', this.onPointerMove);
    surface.addEventListener('pointerup', this.onPointerUp);
    surface.addEventListener('pointercancel', () => (this.touchStart = null));
  }

  on(handler: ActionHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  emit(action: Action, source: InputSource): void {
    this.lastSource = source;
    for (const handler of [...this.handlers]) handler(action, source);
  }

  /** Poll gamepads; call once per frame. */
  update(): void {
    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (!pad) continue;
      const previous = this.padState.get(pad.index) ?? [];
      const current = pad.buttons.map((b) => b.pressed);
      for (const [button, action] of PadMap) {
        if (current[button] && !previous[button]) this.emit(action, 'gamepad');
      }
      this.padState.set(pad.index, current);
      // Left stick as a latched d-pad.
      const [x = 0, y = 0] = pad.axes;
      let stick: Action | null = null;
      if (Math.max(Math.abs(x), Math.abs(y)) > 0.6) {
        stick = Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : y > 0 ? 'down' : 'up';
      } else if (Math.max(Math.abs(x), Math.abs(y)) > 0.35) {
        stick = this.stickLatch.get(pad.index) ?? null;
      }
      if (stick && stick !== this.stickLatch.get(pad.index)) this.emit(stick, 'gamepad');
      this.stickLatch.set(pad.index, stick);
    }
  }

  private onKey = (event: KeyboardEvent): void => {
    const action = KeyMap[event.code];
    if (!action || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    this.emit(action, 'keyboard');
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if ((event.target as HTMLElement).closest('[data-ui]')) return;
    this.touchStart = { x: event.clientX, y: event.clientY, id: event.pointerId, time: performance.now(), fired: false };
  };

  private onPointerMove = (event: PointerEvent): void => {
    const start = this.touchStart;
    if (!start || start.id !== event.pointerId || start.fired) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) < SwipeMinPixels) return;
    // Fire as soon as the swipe is clear, not on release: steering has to feel instant.
    start.fired = true;
    this.emit(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up', this.pointerSource(event));
  };

  private onPointerUp = (event: PointerEvent): void => {
    const start = this.touchStart;
    this.touchStart = null;
    if (!start || start.id !== event.pointerId || start.fired) return;
    if (performance.now() - start.time > 600) return;
    const source = this.pointerSource(event);
    if (this.tapZones) {
      this.emit(event.clientX < window.innerWidth / 2 ? 'left' : 'right', source);
    } else {
      this.emit('select', source);
    }
  };

  private pointerSource(event: PointerEvent): InputSource {
    return event.pointerType === 'mouse' ? 'keyboard' : 'touch';
  }
}
