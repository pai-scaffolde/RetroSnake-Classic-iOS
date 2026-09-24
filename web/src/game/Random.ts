// RetroSnake - seeded random number generators for the game rules.

/** The subset of UE's FRandomStream that FSnakeGame uses. Inject your own for tests or replays. */
export interface SnakeRng {
  /** Re-seed the stream (FRandomStream::Initialize). */
  initialize(seed: number): void;
  /** Uniform integer in [0, a) for a > 0, else 0 (FRandomStream::RandHelper). */
  randHelper(a: number): number;
}

/**
 * Bit-exact port of UE 5.8's FRandomStream (LCG: seed = seed * 196314165 + 907633515).
 * With the same seed it yields the same food / bonus positions as the Unreal build.
 */
export class RandomStream implements SnakeRng {
  private seed = 0;
  private initialSeed = 0;

  constructor(seed = 0) {
    this.initialize(seed);
  }

  initialize(seed: number): void {
    this.initialSeed = seed | 0;
    this.seed = this.initialSeed >>> 0;
  }

  reset(): void {
    this.seed = this.initialSeed >>> 0;
  }

  getInitialSeed(): number {
    return this.initialSeed;
  }

  getCurrentSeed(): number {
    return this.seed | 0;
  }

  private mutateSeed(): void {
    this.seed = (Math.imul(this.seed, 196314165) + 907633515) >>> 0;
  }

  /** [0, 1), built from the top 23 bits exactly like UE's float bit trick. */
  getFraction(): number {
    this.mutateSeed();
    return (this.seed >>> 9) / 8388608;
  }

  getUnsignedInt(): number {
    this.mutateSeed();
    return this.seed;
  }

  randHelper(a: number): number {
    // float(GetFraction() * float(A)), truncated towards zero.
    return a > 0 ? Math.trunc(Math.fround(this.getFraction() * Math.fround(a))) : 0;
  }

  randRange(min: number, max: number): number {
    const range = max - min + 1;
    return min + this.randHelper(range);
  }
}

/** Small, fast alternative generator (not UE-compatible). */
export class Mulberry32 implements SnakeRng {
  private state = 0;

  constructor(seed = 0) {
    this.initialize(seed);
  }

  initialize(seed: number): void {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  randHelper(a: number): number {
    return a > 0 ? Math.min(Math.floor(this.next() * a), a - 1) : 0;
  }
}

/** Equivalent of FMath::Rand() for picking a fresh game seed: an int in [0, 32767]. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 32768);
}
