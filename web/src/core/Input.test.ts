import { afterEach, describe, expect, it, vi } from 'vitest';
import { Input, type Action } from './Input';

function pointer(surface: EventTarget, type: string, id: number, x: number, y: number): void {
  const event = Object.assign(new Event(type), {
    pointerId: id,
    pointerType: 'touch',
    button: 0,
    clientX: x,
    clientY: y,
  });
  surface.dispatchEvent(event);
}

describe('mobile pointer steering', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the first steering swipe when a second finger touches and lifts', () => {
    vi.stubGlobal('window', Object.assign(new EventTarget(), { innerWidth: 393 }));
    const surface = Object.assign(new EventTarget(), { closest: () => null });
    const input = new Input(surface as unknown as HTMLElement);
    const actions: Action[] = [];
    input.on((action) => actions.push(action));

    pointer(surface, 'pointerdown', 1, 80, 300);
    pointer(surface, 'pointerdown', 2, 300, 300);
    pointer(surface, 'pointerup', 2, 300, 300);
    pointer(surface, 'pointermove', 1, 145, 300);
    pointer(surface, 'pointerup', 1, 145, 300);

    expect(actions).toEqual(['right']);
  });

  it('ignores another finger being canceled during the active swipe', () => {
    vi.stubGlobal('window', Object.assign(new EventTarget(), { innerWidth: 393 }));
    const surface = Object.assign(new EventTarget(), { closest: () => null });
    const input = new Input(surface as unknown as HTMLElement);
    const actions: Action[] = [];
    input.on((action) => actions.push(action));

    pointer(surface, 'pointerdown', 1, 80, 300);
    pointer(surface, 'pointercancel', 2, 200, 300);
    pointer(surface, 'pointermove', 1, 145, 300);

    expect(actions).toEqual(['right']);
  });
});
