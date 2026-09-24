// RetroSnake - pure game rules. No DOM, no rendering engine: easy to reason about and to test.
// Port of Source/RetroSnake/{Public,Private}/SnakeGame.*

import { LcdFramebuffer } from './LcdFramebuffer.ts';
import { RandomStream, type SnakeRng } from './Random.ts';

export interface IntPoint {
  x: number;
  y: number;
}

/** Same ordering/values as the C++ enum class ESnakeDir : uint8. */
export const ESnakeDir = { Up: 0, Down: 1, Left: 2, Right: 3 } as const;
export type ESnakeDir = (typeof ESnakeDir)[keyof typeof ESnakeDir];

/** Same ordering/values as the C++ enum class ESnakeMaze : uint8 (saves index by these). */
export const ESnakeMaze = { Open: 0, Box: 1, Tunnel: 2, Mill: 3, Rails: 4, Count: 5 } as const;
export type ESnakeMaze = (typeof ESnakeMaze)[keyof typeof ESnakeMaze];

/** Bit flags returned by SnakeGame.step(). */
export const SnakeEvents = {
  None: 0,
  Ate: 1 << 0,
  AteBonus: 1 << 1,
  BonusAppeared: 1 << 2,
  BonusExpired: 1 << 3,
  Died: 1 << 4,
  AteTransition: 1 << 5,
} as const;

/** 23 x 13 maze layouts, indexed by ESnakeMaze. '#' = wall. All keep row 6, cols 2..12 clear for the spawn. */
export const LCD_MAZES: readonly (readonly string[])[] = [
  [
    // Open - no walls, the snake wraps around the screen edges
    '.......................', '.......................', '.......................',
    '.......................', '.......................', '.......................',
    '.......................', '.......................', '.......................',
    '.......................', '.......................', '.......................',
    '.......................',
  ],
  [
    // Box
    '#######################', '#.....................#', '#.....................#',
    '#.....................#', '#.....................#', '#.....................#',
    '#.....................#', '#.....................#', '#.....................#',
    '#.....................#', '#.....................#', '#.....................#',
    '#######################',
  ],
  [
    // Tunnel
    '########.......########', '#.....................#', '#.....................#',
    '#....#############....#', '#.....................#', '.......................',
    '.......................', '.......................', '#.....................#',
    '#....#############....#', '#.....................#', '#.....................#',
    '########.......########',
  ],
  [
    // Mill
    '.......................', '...............#.......', '...............#.......',
    '...########....#.......', '...............#.......', '...............#.......',
    '.......................', '.......#...............', '.......#...............',
    '.......#....########...', '.......#...............', '.......#...............',
    '.......................',
  ],
  [
    // Rails
    '.......................', '.....#.....#.....#.....', '.....#.....#.....#.....',
    '.....#.....#.....#.....', '.....#.....#.....#.....', '.......................',
    '.......................', '.......................', '.....#.....#.....#.....',
    '.....#.....#.....#.....', '.....#.....#.....#.....', '.....#.....#.....#.....',
    '.......................',
  ],
];

/** 7x3 bonus critters, spanning two cells (3 + 1 link + 3 pixels). Index = bonus kind. */
export const CRITTERS: readonly (readonly string[])[] = [
  ['#.#.#.#', '.#####.', '#.#.#.#'], // spider
  ['#..###.', '#######', '#..###.'], // fish
  ['.#...#.', '#######', '.#.#.#.'], // beetle
  ['#.....#', '.##.##.', '...#...'], // bird
];

/** LCD voxel heights used by render(). */
export const HeadHeight = 135;
export const FoodHeight = 120;
export const WallHeight = 90;

const MAX_INT32 = 2147483647;

function pt(x: number, y: number): IntPoint {
  return { x, y };
}

function samePoint(a: IntPoint, b: IntPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

/** printf("%0Nd") */
function zeroPad(value: number, width: number): string {
  const digits = String(Math.abs(Math.trunc(value)));
  const sign = value < 0 ? '-' : '';
  return sign + digits.padStart(width - sign.length, '0');
}

/** C fmod semantics (result takes the sign of the dividend) - same as JS %. */
function fmod(a: number, b: number): number {
  return a % b;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * The Snake rules. Two flavours share them:
 *  - LCD mode (reset): the phone's 23x13 board, edges wrap around, drawn into the 95x64 framebuffer.
 *  - Arena mode (resetArena): the 3D game's 24x24 board, no wrap - leaving the board means falling off the island.
 */
export class SnakeGame {
  static readonly LcdCols = 23;
  static readonly LcdRows = 13;
  static readonly ArenaSize = 24;
  static readonly MaxLevel = 9;
  static readonly FoodsPerBonus = 5;
  static readonly BonusSteps = 24;
  static readonly NumCritters = 4;
  /** Arena only: eat again within this many steps to grow the combo multiplier. */
  static readonly ComboWindowSteps = 16;
  static readonly MaxCombo = 5;

  private body: IntPoint[] = []; // [0] is the head
  private turnQueue: ESnakeDir[] = [];
  private walls: boolean[] = [];
  private dir: ESnakeDir = ESnakeDir.Right;
  private maze: ESnakeMaze = ESnakeMaze.Open;
  private food: IntPoint = pt(-1, -1);
  private bonusPos: IntPoint = pt(-1, -1);
  private transitionPos: IntPoint = pt(-1, -1);
  private readonly rng: SnakeRng;
  private cols = SnakeGame.LcdCols;
  private rows = SnakeGame.LcdRows;
  private bonusTimer = 0;
  private bonusKind = 0;
  private foodEaten = 0;
  private score = 0;
  private level = 5;
  private pendingGrowth = 0;
  private combo = 1;
  private stepsSinceFood = 0;
  private lastPoints = 0;
  private bonusActive = false;
  private wrap = true;
  private dead = false;

  /** @param rng Seeded generator; defaults to a bit-exact port of UE's FRandomStream. */
  constructor(rng: SnakeRng = new RandomStream()) {
    this.rng = rng;
  }

  // ---------------------------------------------------------------- reset

  private resetCommon(inLevel: number, inMaze: ESnakeMaze, seed: number, inCols: number, inRows: number, spawnHead: IntPoint): void {
    this.level = clamp(inLevel, 1, SnakeGame.MaxLevel);
    this.maze = inMaze;
    this.cols = inCols;
    this.rows = inRows;
    this.rng.initialize(seed);
    this.walls = new Array<boolean>(this.cols * this.rows).fill(false);

    this.body = [];
    for (let offset = 0; offset < 7; ++offset) {
      this.body.push(pt(spawnHead.x - offset, spawnHead.y));
    }
    this.dir = ESnakeDir.Right;
    this.turnQueue = [];
    this.score = 0;
    this.foodEaten = 0;
    this.pendingGrowth = 0;
    this.combo = 1;
    this.stepsSinceFood = 0;
    this.lastPoints = 0;
    this.bonusActive = false;
    this.bonusTimer = 0;
    this.transitionPos = pt(-1, -1);
    this.dead = false;
  }

  /** LCD mode: 23x13, wrapping edges, maze from LCD_MAZES. */
  reset(inLevel: number, inMaze: ESnakeMaze, seed: number): void {
    this.wrap = true;
    this.resetCommon(inLevel, inMaze, seed, SnakeGame.LcdCols, SnakeGame.LcdRows, pt(9, 6));
    const layout = LCD_MAZES[this.maze] as readonly string[] | undefined;
    if (layout) {
      for (let row = 0; row < this.rows; ++row) {
        for (let col = 0; col < this.cols; ++col) {
          this.walls[row * this.cols + col] = layout[row][col] === '#';
        }
      }
    }
    this.spawnFood();
  }

  /** Arena mode: 24x24, no wrap. */
  resetArena(inLevel: number, inMaze: ESnakeMaze, seed: number): void {
    this.wrap = false;
    this.resetCommon(inLevel, inMaze, seed, SnakeGame.ArenaSize, SnakeGame.ArenaSize, pt(8, 12));
    this.buildArenaWalls();
    this.spawnFood();
  }

  private buildArenaWalls(): void {
    // Layouts for the 24x24 arena. Row 12, cols 1..9 always stays clear for the spawn.
    const wall = (col: number, row: number): void => {
      if (this.inBounds(pt(col, row))) this.walls[row * this.cols + col] = true;
    };
    const hBar = (row: number, c0: number, c1: number, gap0 = -1, gap1 = -2): void => {
      for (let c = c0; c <= c1; ++c) if (c < gap0 || c > gap1) wall(c, row);
    };
    const vBar = (col: number, r0: number, r1: number, gap0 = -1, gap1 = -2): void => {
      for (let r = r0; r <= r1; ++r) if (r < gap0 || r > gap1) wall(col, r);
    };

    switch (this.maze) {
      case ESnakeMaze.Box:
        hBar(3, 3, 20, 10, 13);
        hBar(20, 3, 20, 10, 13);
        vBar(3, 3, 20, 10, 13);
        vBar(20, 3, 20, 10, 13);
        break;
      case ESnakeMaze.Tunnel:
        hBar(7, 5, 18);
        hBar(16, 5, 18);
        break;
      case ESnakeMaze.Mill:
        hBar(6, 6, 12);
        vBar(17, 3, 10);
        hBar(17, 11, 17);
        vBar(6, 13, 20);
        break;
      case ESnakeMaze.Rails:
        for (const col of [6, 12, 17]) {
          vBar(col, 3, 8);
          vBar(col, 15, 20);
        }
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- static helpers

  static getMazeName(inMaze: number): string {
    switch (inMaze) {
      case ESnakeMaze.Open: return 'OPEN';
      case ESnakeMaze.Box: return 'BOX';
      case ESnakeMaze.Tunnel: return 'TUNNEL';
      case ESnakeMaze.Mill: return 'MILL';
      case ESnakeMaze.Rails: return 'RAILS';
      default: return '?';
    }
  }

  static dirDelta(d: ESnakeDir): IntPoint {
    switch (d) {
      case ESnakeDir.Up: return pt(0, -1);
      case ESnakeDir.Down: return pt(0, 1);
      case ESnakeDir.Left: return pt(-1, 0);
      default: return pt(1, 0);
    }
  }

  static isOpposite(a: ESnakeDir, b: ESnakeDir): boolean {
    const da = SnakeGame.dirDelta(a);
    const db = SnakeGame.dirDelta(b);
    return da.x + db.x === 0 && da.y + db.y === 0;
  }

  /** Board coordinates: Right = +col, Down = +row. Seen from above, turning left from Right faces Up. */
  static turnLeft(d: ESnakeDir): ESnakeDir {
    switch (d) {
      case ESnakeDir.Right: return ESnakeDir.Up;
      case ESnakeDir.Up: return ESnakeDir.Left;
      case ESnakeDir.Left: return ESnakeDir.Down;
      default: return ESnakeDir.Right;
    }
  }

  static turnRight(d: ESnakeDir): ESnakeDir {
    return SnakeGame.turnLeft(SnakeGame.turnLeft(SnakeGame.turnLeft(d)));
  }

  static drawCritter(fb: LcdFramebuffer, x: number, y: number, kind: number, value: number): void {
    fb.drawBitmap(x, y, CRITTERS[clamp(kind, 0, SnakeGame.NumCritters - 1)], value);
  }

  /** Screen-space pixel of a cell's top-left corner (LCD mode). */
  static cellPixelX(col: number): number {
    return 2 + 4 * col;
  }

  static cellPixelY(row: number): number {
    return 11 + 4 * row;
  }

  // ---------------------------------------------------------------- input / timing

  /** Queue a direction change; reversals and repeats are ignored. Up to 3 turns buffer. */
  queueTurn(newDir: ESnakeDir): void {
    const last = this.turnQueue.length > 0 ? this.turnQueue[this.turnQueue.length - 1] : this.dir;
    if (newDir === last || SnakeGame.isOpposite(newDir, last) || this.turnQueue.length >= 3) {
      return;
    }
    this.turnQueue.push(newDir);
  }

  /** Seconds between steps for the current level. */
  getStepInterval(): number {
    // Level 1 is a lazy stroll, level 9 is the "how is anyone this fast" of the school bus.
    // The 3D arena runs a touch slower so the chase camera stays readable.
    // In the arena the snake also speeds up a little with every bite, down to 60% of the base interval.
    return this.wrap
      ? 0.4 * Math.pow(0.84, this.level - 1)
      : 0.3 * Math.pow(0.88, this.level - 1) * Math.max(0.6, Math.pow(0.985, this.foodEaten));
  }

  // ---------------------------------------------------------------- simulation

  /** Neighbour of p in direction d, or null if it falls off a non-wrapping board. */
  private neighbor(p: IntPoint, d: ESnakeDir): IntPoint | null {
    const out = this.rawNeighbor(p, d);
    return this.wrap || this.inBounds(out) ? out : null;
  }

  /** Neighbor() ignoring the on-board result (the C++ Out param is always written). */
  private rawNeighbor(p: IntPoint, d: ESnakeDir): IntPoint {
    const delta = SnakeGame.dirDelta(d);
    const out = pt(p.x + delta.x, p.y + delta.y);
    if (this.wrap) {
      out.x = ((out.x % this.cols) + this.cols) % this.cols;
      out.y = ((out.y % this.rows) + this.rows) % this.rows;
    }
    return out;
  }

  private isBody(p: IntPoint, ignoreTail: boolean): boolean {
    const count = ignoreTail ? this.body.length - 1 : this.body.length;
    for (let index = 0; index < count; ++index) {
      if (samePoint(this.body[index], p)) {
        return true;
      }
    }
    return false;
  }

  private isBonusCell(p: IntPoint): boolean {
    return this.bonusActive && (samePoint(p, this.bonusPos) || samePoint(p, pt(this.bonusPos.x + 1, this.bonusPos.y)));
  }

  private randomFreeCell(needsRightNeighbour: boolean): IntPoint {
    const isFree = (p: IntPoint): boolean =>
      !this.isWall(p) && !this.isBody(p, false) && !samePoint(p, this.food) &&
      !this.isBonusCell(p) && !samePoint(p, this.transitionPos);
    const candidates: IntPoint[] = [];
    for (let row = 0; row < this.rows; ++row) {
      for (let col = 0; col < this.cols - (needsRightNeighbour ? 1 : 0); ++col) {
        const p = pt(col, row);
        if (isFree(p) && (!needsRightNeighbour || isFree(pt(col + 1, row)))) {
          candidates.push(p);
        }
      }
    }
    return candidates.length > 0 ? candidates[this.rng.randHelper(candidates.length)] : pt(-1, -1);
  }

  private spawnFood(): void {
    this.food = pt(-1, -1);
    this.food = this.randomFreeCell(false);
  }

  private spawnBonus(): void {
    const p = this.randomFreeCell(true);
    if (p.x >= 0) {
      this.bonusPos = p;
      this.bonusKind = this.rng.randHelper(SnakeGame.NumCritters);
      this.bonusTimer = SnakeGame.BonusSteps;
      this.bonusActive = true;
    }
  }

  /** Place the optional arena transition collectible on a free cell. It remains until eaten or cleared. */
  spawnTransition(): boolean {
    if (this.wrap || this.dead) return false;
    if (this.isTransitionActive()) return true;
    this.transitionPos = this.randomFreeCell(false);
    return this.isTransitionActive();
  }

  clearTransition(): void {
    this.transitionPos = pt(-1, -1);
  }

  /** Advance one step. Returns a mask of SnakeEvents. */
  step(): number {
    if (this.dead || this.body.length === 0) {
      return SnakeEvents.None;
    }

    let events: number = SnakeEvents.None;
    ++this.stepsSinceFood;
    if (!this.wrap && this.stepsSinceFood > SnakeGame.ComboWindowSteps) {
      this.combo = 1;
    }
    const queued = this.turnQueue.shift();
    if (queued !== undefined) {
      this.dir = queued;
    }

    const next = this.neighbor(this.body[0], this.dir);

    const tailMoves = this.pendingGrowth === 0;
    if (next === null || this.isWall(next) || this.isBody(next, tailMoves)) {
      this.dead = true;
      return SnakeEvents.Died;
    }

    this.body.unshift(next);
    if (tailMoves) {
      this.body.pop();
    } else {
      --this.pendingGrowth;
    }

    if (samePoint(next, this.food)) {
      if (!this.wrap) {
        this.combo =
          this.foodEaten > 0 && this.stepsSinceFood <= SnakeGame.ComboWindowSteps
            ? Math.min(this.combo + 1, SnakeGame.MaxCombo)
            : 1;
      }
      this.lastPoints = this.level * this.combo;
      this.stepsSinceFood = 0;
      this.score += this.lastPoints;
      ++this.foodEaten;
      ++this.pendingGrowth;
      events |= SnakeEvents.Ate;
      this.spawnFood();
      if (this.foodEaten % SnakeGame.FoodsPerBonus === 0 && !this.bonusActive) {
        this.spawnBonus();
        if (this.bonusActive) {
          events |= SnakeEvents.BonusAppeared;
        }
      }
    } else if (this.isBonusCell(next)) {
      this.lastPoints = (5 * this.level + 2 * this.bonusTimer) * this.combo;
      this.score += this.lastPoints;
      this.bonusActive = false;
      events |= SnakeEvents.AteBonus;
    } else if (samePoint(next, this.transitionPos)) {
      this.clearTransition();
      events |= SnakeEvents.AteTransition;
    }

    if (this.bonusActive && !(events & SnakeEvents.BonusAppeared)) {
      if (--this.bonusTimer <= 0) {
        this.bonusActive = false;
        events |= SnakeEvents.BonusExpired;
      }
    }
    return events;
  }

  // ---------------------------------------------------------------- autopilot

  private floodFillCount(from: IntPoint, blocked: readonly boolean[]): number {
    const seen = blocked.slice();
    const stack: IntPoint[] = [from];
    seen[from.y * this.cols + from.x] = true;
    let count = 0;
    let p: IntPoint | undefined;
    while ((p = stack.pop()) !== undefined) {
      ++count;
      for (let d = 0; d < 4; ++d) {
        const n = this.neighbor(p, d as ESnakeDir);
        if (n === null) {
          continue;
        }
        if (!seen[n.y * this.cols + n.x]) {
          seen[n.y * this.cols + n.x] = true;
          stack.push(n);
        }
      }
    }
    return count;
  }

  /** Simple BFS autopilot used for the attract-mode demo and automated QA runs. */
  chooseAutopilotDir(): ESnakeDir {
    const cols = this.cols;
    const blocked = this.walls.slice();
    const tailMoves = this.pendingGrowth === 0;
    for (let index = 0; index < this.body.length - (tailMoves ? 1 : 0); ++index) {
      blocked[this.body[index].y * cols + this.body[index].x] = true;
    }

    // Distance field from the targets (food, bonus, and transition) over free cells.
    const dist = new Array<number>(cols * this.rows).fill(MAX_INT32);
    const queue: IntPoint[] = [];
    const seed = (p: IntPoint): void => {
      if (this.inBounds(p) && !blocked[p.y * cols + p.x]) {
        dist[p.y * cols + p.x] = 0;
        queue.push(p);
      }
    };
    seed(this.food);
    if (this.isTransitionActive()) seed(this.transitionPos);
    if (this.bonusActive) {
      seed(this.bonusPos);
      seed(pt(this.bonusPos.x + 1, this.bonusPos.y));
    }
    for (let head = 0; head < queue.length; ++head) {
      const p = queue[head];
      for (let d = 0; d < 4; ++d) {
        const n = this.neighbor(p, d as ESnakeDir);
        if (n === null) {
          continue;
        }
        const ni = n.y * cols + n.x;
        if (!blocked[ni] && dist[ni] === MAX_INT32) {
          dist[ni] = dist[p.y * cols + p.x] + 1;
          queue.push(n);
        }
      }
    }

    let best = this.dir;
    let bestScore = -Infinity;
    for (let d = 0; d < 4; ++d) {
      const candidate = d as ESnakeDir;
      if (SnakeGame.isOpposite(candidate, this.dir)) {
        continue;
      }
      const n = this.neighbor(this.body[0], candidate);
      if (n === null || blocked[n.y * cols + n.x]) {
        continue;
      }
      const future = blocked.slice();
      future[this.body[0].y * cols + this.body[0].x] = true;
      const room = this.floodFillCount(n, future);
      const roomy = room >= this.body.length + 2;
      const d2Food = dist[n.y * cols + n.x] === MAX_INT32 ? 10000 : dist[n.y * cols + n.x];
      const score = (roomy ? 1000000 : 0) + (roomy ? -d2Food * 10 : room) + (candidate === this.dir ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- rendering (LCD)

  /** LCD mode only: draws status bar, frame, maze, food, bonus and (optionally) the snake. */
  render(fb: LcdFramebuffer, drawSnake: boolean, demoBanner: boolean, time: number): void {
    const On = LcdFramebuffer.On;

    // Status bar
    if (demoBanner) {
      if (fmod(time, 1.2) < 0.8) {
        fb.drawTextCentered(1, 'PRESS ANY KEY');
      }
    } else {
      fb.drawText(1, 1, zeroPad(this.score, 4));
      if (this.bonusActive) {
        SnakeGame.drawCritter(fb, 68, 3, this.bonusKind, On);
        fb.drawTextRight(93, 1, zeroPad(this.bonusTimer, 2));
      }
    }

    // Frame
    fb.rectOutline(0, 9, LcdFramebuffer.Width, LcdFramebuffer.Height - 9);

    // Walls, joined into solid shapes
    for (let row = 0; row < this.rows; ++row) {
      for (let col = 0; col < this.cols; ++col) {
        if (!this.isWall(pt(col, row))) {
          continue;
        }
        const x = SnakeGame.cellPixelX(col);
        const y = SnakeGame.cellPixelY(row);
        const right = col + 1 < this.cols && this.isWall(pt(col + 1, row));
        const down = row + 1 < this.rows && this.isWall(pt(col, row + 1));
        fb.fillRect(x, y, 3, 3, WallHeight);
        if (right) fb.fillRect(x + 3, y, 1, 3, WallHeight);
        if (down) fb.fillRect(x, y + 3, 3, 1, WallHeight);
        if (right && down && this.isWall(pt(col + 1, row + 1))) fb.set(x + 3, y + 3, WallHeight);
      }
    }

    // Food: a little diamond
    if (this.food.x >= 0) {
      const x = SnakeGame.cellPixelX(this.food.x);
      const y = SnakeGame.cellPixelY(this.food.y);
      fb.set(x + 1, y, FoodHeight);
      fb.fillRect(x, y + 1, 3, 1, FoodHeight);
      fb.set(x + 1, y + 2, FoodHeight);
    }

    if (this.bonusActive) {
      SnakeGame.drawCritter(fb, SnakeGame.cellPixelX(this.bonusPos.x), SnakeGame.cellPixelY(this.bonusPos.y), this.bonusKind, FoodHeight);
    }

    if (!drawSnake || this.body.length === 0) {
      return;
    }

    for (let index = this.body.length - 1; index >= 0; --index) {
      const p = this.body[index];
      const x = SnakeGame.cellPixelX(p.x);
      const y = SnakeGame.cellPixelY(p.y);
      fb.fillRect(x, y, 3, 3, index === 0 ? HeadHeight : On);

      // Link to the next segment towards the tail, unless it wrapped around the screen.
      if (index + 1 < this.body.length) {
        const dx = this.body[index + 1].x - p.x;
        const dy = this.body[index + 1].y - p.y;
        if (dx === 1 && dy === 0) fb.fillRect(x + 3, y, 1, 3);
        else if (dx === -1 && dy === 0) fb.fillRect(x - 1, y, 1, 3);
        else if (dx === 0 && dy === 1) fb.fillRect(x, y + 3, 3, 1);
        else if (dx === 0 && dy === -1) fb.fillRect(x, y - 1, 3, 1);
      }
    }

    // Open mouth when something tasty is right in front of the head.
    const ahead = this.rawNeighbor(this.body[0], this.dir);
    if (samePoint(ahead, this.food) || this.isBonusCell(ahead)) {
      const x = SnakeGame.cellPixelX(this.body[0].x);
      const y = SnakeGame.cellPixelY(this.body[0].y);
      switch (this.dir) {
        case ESnakeDir.Right: fb.set(x + 2, y + 1, 0); break;
        case ESnakeDir.Left: fb.set(x, y + 1, 0); break;
        case ESnakeDir.Up: fb.set(x + 1, y, 0); break;
        case ESnakeDir.Down: fb.set(x + 1, y + 2, 0); break;
      }
    }
  }

  // ---------------------------------------------------------------- accessors

  isDead(): boolean { return this.dead; }
  isArena(): boolean { return !this.wrap; }
  getCols(): number { return this.cols; }
  getRows(): number { return this.rows; }
  getScore(): number { return this.score; }
  getLevel(): number { return this.level; }
  getFoodEaten(): number { return this.foodEaten; }
  getMaze(): ESnakeMaze { return this.maze; }
  getHead(): IntPoint { return this.body.length > 0 ? { ...this.body[0] } : pt(0, 0); }
  /** Head first. Live read-only view of the internal array (segments are never mutated in place). */
  getBody(): readonly Readonly<IntPoint>[] { return this.body; }
  getDir(): ESnakeDir { return this.dir; }
  /** The direction the snake will be heading once all buffered turns are applied. */
  getQueuedDir(): ESnakeDir {
    return this.turnQueue.length > 0 ? this.turnQueue[this.turnQueue.length - 1] : this.dir;
  }
  getLength(): number { return this.body.length; }
  isBonusActive(): boolean { return this.bonusActive; }
  getBonusPos(): IntPoint { return { ...this.bonusPos }; }
  getBonusKind(): number { return this.bonusKind; }
  getBonusTimer(): number { return this.bonusTimer; }
  getFood(): IntPoint { return { ...this.food }; }
  isTransitionActive(): boolean { return this.transitionPos.x >= 0; }
  getTransitionPos(): IntPoint { return { ...this.transitionPos }; }
  getCombo(): number { return this.combo; }
  /** Points awarded by the most recent food or bonus. */
  getLastPoints(): number { return this.lastPoints; }
  /** 1 right after eating, falling to 0 when the combo window closes (always 0 in LCD mode). */
  getComboRemaining(): number {
    return this.wrap ? 0 : clamp(1 - this.stepsSinceFood / SnakeGame.ComboWindowSteps, 0, 1);
  }
  isWall(p: IntPoint): boolean {
    return this.inBounds(p) && this.walls[p.y * this.cols + p.x];
  }
  inBounds(p: IntPoint): boolean {
    return p.x >= 0 && p.y >= 0 && p.x < this.cols && p.y < this.rows;
  }

  /** Test hook: place the food somewhere specific. */
  setFoodForTest(cell: IntPoint): void {
    this.food = { ...cell };
  }

  /** Test hook: place a transition collectible on a legal arena cell. */
  setTransitionForTest(cell: IntPoint): void {
    if (this.wrap || !this.inBounds(cell) || this.isWall(cell) || this.isBody(cell, false) ||
        samePoint(cell, this.food) || this.isBonusCell(cell)) {
      throw new Error('Transition collectible needs a free arena cell');
    }
    this.transitionPos = { ...cell };
  }
}
