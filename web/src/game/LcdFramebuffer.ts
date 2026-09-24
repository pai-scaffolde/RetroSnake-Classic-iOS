// RetroSnake - 1-bit(ish) LCD framebuffer. Everything the player sees on the phone is drawn here.
// Port of Source/RetroSnake/{Public,Private}/LcdFramebuffer.*

/** Hand-drawn 5x7 font in the spirit of early-2000s phone UIs. 5 bits per row, MSB = leftmost pixel. */
export const GLYPHS: Readonly<Record<string, readonly number[]>> = {
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
  '0': [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  '1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  '2': [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  '3': [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110],
  '4': [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  '5': [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  '6': [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  '7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  '8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  '9': [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  ':': [0b00000, 0b01100, 0b01100, 0b00000, 0b01100, 0b01100, 0b00000],
  '!': [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00000, 0b00100],
  '?': [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b00000, 0b00100],
  '.': [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b01100, 0b01100],
  ',': [0b00000, 0b00000, 0b00000, 0b00000, 0b01100, 0b00100, 0b01000],
  '-': [0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000],
  '+': [0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000],
  '<': [0b00010, 0b00100, 0b01000, 0b10000, 0b01000, 0b00100, 0b00010],
  '>': [0b01000, 0b00100, 0b00010, 0b00001, 0b00010, 0b00100, 0b01000],
  '/': [0b00000, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b00000],
  "'": [0b01100, 0b00100, 0b01000, 0b00000, 0b00000, 0b00000, 0b00000],
  '#': [0b01010, 0b01010, 0b11111, 0b01010, 0b11111, 0b01010, 0b01010],
  '*': [0b00000, 0b10101, 0b01110, 0b11111, 0b01110, 0b10101, 0b00000],
};

/** Glyph rows for a character (lower case folded), or undefined for space / unknown characters. */
export function findGlyph(c: string): readonly number[] | undefined {
  const upper = c.toUpperCase();
  return Object.prototype.hasOwnProperty.call(GLYPHS, upper) ? GLYPHS[upper] : undefined;
}

/**
 * A tiny monochrome framebuffer matching the phone's LCD. Each pixel stores a "height" byte rather
 * than a bool: 0 = off, 100 = a normal lit pixel, >100 = a lit pixel that rises taller as a voxel
 * (used for the snake's head, food, highlights...). The renderer turns these into 3D voxels.
 */
export class LcdFramebuffer {
  static readonly Width = 95;
  static readonly Height = 64;
  static readonly On = 100;
  /** Glyph cell size of the built-in 5x7 font (advance is GlyphW + 1). */
  static readonly GlyphW = 5;
  static readonly GlyphH = 7;

  private readonly pixels = new Uint8Array(LcdFramebuffer.Width * LcdFramebuffer.Height);

  clear(value = 0): void {
    this.pixels.fill(value);
  }

  set(x: number, y: number, value: number = LcdFramebuffer.On): void {
    if (x >= 0 && x < LcdFramebuffer.Width && y >= 0 && y < LcdFramebuffer.Height) {
      this.pixels[y * LcdFramebuffer.Width + x] = value; // Uint8Array wraps like the C++ uint8 param
    }
  }

  get(x: number, y: number): number {
    return x >= 0 && x < LcdFramebuffer.Width && y >= 0 && y < LcdFramebuffer.Height
      ? this.pixels[y * LcdFramebuffer.Width + x]
      : 0;
  }

  fillRect(x: number, y: number, w: number, h: number, value: number = LcdFramebuffer.On): void {
    for (let row = y; row < y + h; ++row) {
      for (let col = x; col < x + w; ++col) {
        this.set(col, row, value);
      }
    }
  }

  rectOutline(x: number, y: number, w: number, h: number, value: number = LcdFramebuffer.On): void {
    this.fillRect(x, y, w, 1, value);
    this.fillRect(x, y + h - 1, w, 1, value);
    this.fillRect(x, y, 1, h, value);
    this.fillRect(x + w - 1, y, 1, h, value);
  }

  /** Draws upper-case text (lower case is folded). Returns the X just past the last glyph. */
  drawText(x: number, y: number, text: string, scale = 1, value: number = LcdFramebuffer.On): number {
    const { GlyphW, GlyphH } = LcdFramebuffer;
    // Iterate UTF-16 code units, matching TCHAR iteration and MeasureText's Len().
    for (let i = 0; i < text.length; ++i) {
      const rows = findGlyph(text[i]);
      if (rows) {
        for (let row = 0; row < GlyphH; ++row) {
          for (let col = 0; col < GlyphW; ++col) {
            if (rows[row] & (1 << (GlyphW - 1 - col))) {
              this.fillRect(x + col * scale, y + row * scale, scale, scale, value);
            }
          }
        }
      }
      x += (GlyphW + 1) * scale;
    }
    return x;
  }

  static measureText(text: string, scale = 1): number {
    return text.length > 0 ? (text.length * (LcdFramebuffer.GlyphW + 1) - 1) * scale : 0;
  }

  drawTextCentered(y: number, text: string, scale = 1, value: number = LcdFramebuffer.On): void {
    // C++ integer division truncates towards zero.
    this.drawText(Math.trunc((LcdFramebuffer.Width - LcdFramebuffer.measureText(text, scale)) / 2), y, text, scale, value);
  }

  drawTextRight(rightX: number, y: number, text: string, scale = 1, value: number = LcdFramebuffer.On): void {
    this.drawText(rightX - LcdFramebuffer.measureText(text, scale) + 1, y, text, scale, value);
  }

  /** Draws a bitmap given as rows of '#' (on) and anything else (transparent). */
  drawBitmap(x: number, y: number, rows: readonly string[], value: number = LcdFramebuffer.On): void {
    for (let row = 0; row < rows.length; ++row) {
      const line = rows[row];
      for (let col = 0; col < line.length; ++col) {
        if (line[col] === '#') {
          this.set(x + col, y + row, value);
        }
      }
    }
  }

  /** Row-major Width*Height height bytes. Live view: do not hold across frames if you need a snapshot. */
  getData(): Readonly<Uint8Array> {
    return this.pixels;
  }
}
