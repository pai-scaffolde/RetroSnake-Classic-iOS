import { describe, expect, it } from 'vitest';
import { LcdFramebuffer, findGlyph } from './LcdFramebuffer.ts';

const litBounds = (fb: LcdFramebuffer): { minX: number; minY: number; maxX: number; maxY: number; count: number } => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, count = 0;
  for (let y = 0; y < LcdFramebuffer.Height; ++y) {
    for (let x = 0; x < LcdFramebuffer.Width; ++x) {
      if (fb.get(x, y)) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        ++count;
      }
    }
  }
  return { minX, minY, maxX, maxY, count };
};

describe('LcdFramebuffer', () => {
  it('is 95x64 and clips out-of-range writes', () => {
    const fb = new LcdFramebuffer();
    expect(fb.getData()).toHaveLength(95 * 64);
    fb.set(-1, 0);
    fb.set(95, 0);
    fb.set(0, 64);
    fb.fillRect(-10, -10, 200, 200, 7);
    expect(fb.getData().every((v) => v === 7)).toBe(true);
    expect(fb.get(-1, -1)).toBe(0);
    fb.clear();
    expect(litBounds(fb).count).toBe(0);
  });

  it('rectOutline draws only the border', () => {
    const fb = new LcdFramebuffer();
    fb.rectOutline(2, 3, 5, 4);
    expect(litBounds(fb)).toEqual({ minX: 2, minY: 3, maxX: 6, maxY: 6, count: 2 * 5 + 2 * 2 });
    expect(fb.get(4, 4)).toBe(0);
  });

  it('text advance, measure and bounds', () => {
    const fb = new LcdFramebuffer();
    expect(fb.drawText(1, 1, 'HI')).toBe(1 + 2 * 6);
    expect(LcdFramebuffer.measureText('HI')).toBe(11);
    expect(LcdFramebuffer.measureText('HI', 2)).toBe(22);
    expect(LcdFramebuffer.measureText('')).toBe(0);
    // H spans the full 5x7 cell; I is 01110 wide.
    expect(litBounds(fb)).toMatchObject({ minX: 1, minY: 1, maxX: 6 + 1 + 3, maxY: 7 });

    const scaled = new LcdFramebuffer();
    scaled.drawText(0, 0, 'H', 2, 125);
    expect(litBounds(scaled)).toMatchObject({ minX: 0, minY: 0, maxX: 9, maxY: 13 });
    expect(scaled.get(0, 0)).toBe(125);
  });

  it('folds lower case and renders unknown characters / spaces blank', () => {
    const a = new LcdFramebuffer();
    a.drawText(0, 0, 'abc');
    const b = new LcdFramebuffer();
    b.drawText(0, 0, 'ABC');
    expect(Array.from(a.getData())).toEqual(Array.from(b.getData()));
    expect(findGlyph(' ')).toBeUndefined();
    expect(findGlyph('~')).toBeUndefined();
    const blank = new LcdFramebuffer();
    expect(blank.drawText(0, 0, ' ~')).toBe(12);
    expect(litBounds(blank).count).toBe(0);
  });

  it('centred and right-aligned text', () => {
    const c = new LcdFramebuffer();
    c.drawTextCentered(10, 'PRESS ANY KEY');
    // Width 13*6-1 = 77 -> x = (95-77)/2 = 9; P starts at its left column.
    expect(litBounds(c)).toMatchObject({ minX: 9, minY: 10 });

    const r = new LcdFramebuffer();
    r.drawTextRight(93, 1, '24');
    const b = litBounds(r);
    expect(b.maxX).toBeLessThanOrEqual(93);
    expect(b.minX).toBe(93 - 11 + 1);
  });

  it('drawBitmap draws # only', () => {
    const fb = new LcdFramebuffer();
    fb.drawBitmap(10, 20, ['#.#', '.#.'], 42);
    expect(fb.get(10, 20)).toBe(42);
    expect(fb.get(11, 20)).toBe(0);
    expect(fb.get(11, 21)).toBe(42);
    expect(litBounds(fb).count).toBe(3);
  });
});
