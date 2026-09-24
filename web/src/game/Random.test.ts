import { describe, expect, it } from 'vitest';
import { Mulberry32, RandomStream } from './Random.ts';

describe('RandomStream (FRandomStream port)', () => {
  it('follows the UE LCG exactly', () => {
    const r = new RandomStream(0);
    // Seed = Seed * 196314165 + 907633515 (mod 2^32)
    expect(r.getUnsignedInt()).toBe(907633515);
    expect(r.getUnsignedInt()).toBe(Number((907633515n * 196314165n + 907633515n) % 4294967296n));
    const neg = new RandomStream(-1);
    expect(neg.getUnsignedInt()).toBe(Number((4294967295n * 196314165n + 907633515n) % 4294967296n));
  });

  it('getFraction uses the top 23 bits and randHelper stays in range', () => {
    const r = new RandomStream(123);
    const probe = new RandomStream(123);
    const bits = probe.getUnsignedInt();
    expect(r.getFraction()).toBe((bits >>> 9) / 2 ** 23);
    for (let i = 0; i < 2000; ++i) {
      const v = r.randHelper(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
      expect(Number.isInteger(v)).toBe(true);
    }
    expect(r.randHelper(0)).toBe(0);
    expect(r.randHelper(-3)).toBe(0);
  });

  it('re-initialising replays the sequence', () => {
    const r = new RandomStream(5);
    const a = [r.randHelper(100), r.randHelper(100), r.randHelper(100)];
    r.initialize(5);
    expect([r.randHelper(100), r.randHelper(100), r.randHelper(100)]).toEqual(a);
    r.reset();
    expect(r.randHelper(100)).toBe(a[0]);
  });
});

describe('Mulberry32', () => {
  it('is deterministic and in range', () => {
    const a = new Mulberry32(9);
    const b = new Mulberry32(9);
    for (let i = 0; i < 500; ++i) {
      const v = a.randHelper(10);
      expect(v).toBe(b.randHelper(10));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
    }
  });
});
