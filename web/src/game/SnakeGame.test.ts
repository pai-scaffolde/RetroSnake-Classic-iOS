import { describe, expect, it } from 'vitest';
import { ESnakeDir, ESnakeMaze, LCD_MAZES, SnakeEvents, SnakeGame, type IntPoint } from './SnakeGame.ts';
import { LcdFramebuffer } from './LcdFramebuffer.ts';
import { Mulberry32 } from './Random.ts';

const P = (x: number, y: number): IntPoint => ({ x, y });
const mazes = Array.from({ length: ESnakeMaze.Count }, (_, i) => i as ESnakeMaze);

// Port of RetroSnake.Rules (Source/RetroSnake/Private/Tests/SnakeGameTests.cpp), split into cases.
describe('RetroSnake.Rules (ported)', () => {
  it('spawn, reversal ignored, eating scores the level and grows by one', () => {
    const game = new SnakeGame();
    game.reset(5, ESnakeMaze.Open, 42);
    expect(game.getLength()).toBe(7);
    expect(game.getHead()).toEqual(P(9, 6));
    expect(game.isDead()).toBe(false);

    // Reversal is ignored
    game.setFoodForTest(P(0, 0));
    game.queueTurn(ESnakeDir.Left);
    game.step();
    expect(game.getHead()).toEqual(P(10, 6));

    // Eating scores the level and grows by one
    game.setFoodForTest(P(11, 6));
    const events = game.step();
    expect(events & SnakeEvents.Ate).not.toBe(0);
    expect(game.getScore()).toBe(5);
    game.setFoodForTest(P(0, 0));
    game.step();
    expect(game.getLength()).toBe(8);
  });

  it('open maze wraps around the edges', () => {
    const game = new SnakeGame();
    game.reset(5, ESnakeMaze.Open, 7);
    game.setFoodForTest(P(0, 12));
    for (let step = 0; step < SnakeGame.LcdCols - 9; ++step) game.step();
    expect(game.getHead().x).toBe(0);
    expect(game.isDead()).toBe(false);
  });

  it('box walls kill', () => {
    const game = new SnakeGame();
    game.reset(5, ESnakeMaze.Box, 7);
    game.setFoodForTest(P(1, 1));
    for (let step = 0; step < 12; ++step) game.step();
    expect(game.isDead()).toBe(false);
    const events = game.step();
    expect(events & SnakeEvents.Died).not.toBe(0);
    expect(game.isDead()).toBe(true);
  });

  it('hitting yourself kills', () => {
    const game = new SnakeGame();
    game.reset(5, ESnakeMaze.Open, 7);
    game.setFoodForTest(P(0, 0));
    game.queueTurn(ESnakeDir.Up);
    game.queueTurn(ESnakeDir.Left);
    game.queueTurn(ESnakeDir.Down);
    game.step();
    game.step();
    expect(game.step() & SnakeEvents.Died).not.toBe(0);
  });

  it.each(mazes)('the autopilot is a competent attract-mode player on LCD maze %i', (maze) => {
    const game = new SnakeGame();
    game.reset(5, maze, 1234 + maze);
    let eaten = 0;
    for (let step = 0; step < 800 && !game.isDead(); ++step) {
      game.queueTurn(game.chooseAutopilotDir());
      eaten += game.step() & SnakeEvents.Ate ? 1 : 0;
    }
    expect(eaten, `autopilot eats on ${SnakeGame.getMazeName(maze)}`).toBeGreaterThanOrEqual(12);
  });

  it('arena: no wrap, falling off the island kills; turning is relative', () => {
    const game = new SnakeGame();
    game.resetArena(5, ESnakeMaze.Open, 11);
    expect(game.getCols()).toBe(SnakeGame.ArenaSize);
    expect(game.getHead()).toEqual(P(8, 12));
    game.setFoodForTest(P(0, 0));
    for (let step = 0; step < SnakeGame.ArenaSize - 9; ++step) game.step();
    expect(game.isDead()).toBe(false);
    expect(game.step() & SnakeEvents.Died).not.toBe(0);
    expect(SnakeGame.turnLeft(ESnakeDir.Right)).toBe(ESnakeDir.Up);
    expect(SnakeGame.turnRight(ESnakeDir.Up)).toBe(ESnakeDir.Right);
    expect(SnakeGame.turnLeft(SnakeGame.turnLeft(SnakeGame.turnLeft(SnakeGame.turnLeft(ESnakeDir.Down))))).toBe(ESnakeDir.Down);
  });

  it.each(mazes)('arena maze %i keeps the spawn row clear and the autopilot eats', (maze) => {
    const game = new SnakeGame();
    game.resetArena(5, maze, 99 + maze);
    for (let col = 1; col <= 9; ++col) expect(game.isWall(P(col, 12))).toBe(false);
    let eaten = 0;
    for (let step = 0; step < 1500 && !game.isDead(); ++step) {
      game.queueTurn(game.chooseAutopilotDir());
      eaten += game.step() & SnakeEvents.Ate ? 1 : 0;
    }
    expect(eaten, `arena autopilot eats on ${SnakeGame.getMazeName(maze)}`).toBeGreaterThanOrEqual(20);
  });

  it('arena combo: quick successive bites multiply the points', () => {
    const game = new SnakeGame();
    game.resetArena(5, ESnakeMaze.Open, 21);
    game.setFoodForTest(P(9, 12));
    game.step();
    expect(game.getScore()).toBe(5);
    game.setFoodForTest(P(10, 12));
    game.step();
    expect(game.getCombo()).toBe(2);
    expect(game.getScore()).toBe(15);
    game.setFoodForTest(P(0, 0));
    for (let step = 0; step < SnakeGame.ComboWindowSteps + 1 && !game.isDead(); ++step) {
      game.queueTurn(game.chooseAutopilotDir());
      game.step();
    }
    expect(game.getCombo()).toBe(1);
  });

  it('rendering never writes outside the framebuffer and draws the frame', () => {
    const frame = new LcdFramebuffer();
    const game = new SnakeGame();
    game.reset(5, ESnakeMaze.Mill, 3);
    game.render(frame, true, false, 0);
    expect(frame.get(0, 9)).toBe(LcdFramebuffer.On);
    expect(frame.get(LcdFramebuffer.Width - 1, LcdFramebuffer.Height - 1)).toBe(LcdFramebuffer.On);
    expect(frame.get(SnakeGame.cellPixelX(9) + 1, SnakeGame.cellPixelY(6) + 1)).toBeGreaterThan(LcdFramebuffer.On);
  });
});

describe('arena transition collectible', () => {
  it('spawns on a distinct free cell, persists, and clears on reset', () => {
    const game = new SnakeGame();
    game.resetArena(5, ESnakeMaze.Open, 41);
    expect(game.spawnTransition()).toBe(true);
    const transition = game.getTransitionPos();
    expect(game.inBounds(transition)).toBe(true);
    expect(game.isWall(transition)).toBe(false);
    expect(game.getBody()).not.toContainEqual(transition);
    expect(transition).not.toEqual(game.getFood());
    expect(game.spawnTransition()).toBe(true);
    expect(game.getTransitionPos()).toEqual(transition);
    game.setFoodForTest(P(0, 0));
    expect(game.step() & SnakeEvents.AteTransition).toBe(0);
    expect(game.getTransitionPos()).toEqual(transition);
    game.resetArena(5, ESnakeMaze.Open, 42);
    expect(game.isTransitionActive()).toBe(false);
    expect(game.getTransitionPos()).toEqual(P(-1, -1));
  });

  it('eating the transition item emits its own event without points, food, or growth', () => {
    const game = new SnakeGame();
    game.resetArena(5, ESnakeMaze.Open, 41);
    game.setFoodForTest(P(0, 0));
    game.setTransitionForTest(P(9, 12));
    const events = game.step();
    expect(events & SnakeEvents.AteTransition).not.toBe(0);
    expect(events & (SnakeEvents.Ate | SnakeEvents.AteBonus)).toBe(0);
    expect(game.getScore()).toBe(0);
    expect(game.getFoodEaten()).toBe(0);
    expect(game.getLength()).toBe(7);
    expect(game.isTransitionActive()).toBe(false);
  });

  it('bonus spawning avoids the transition cell; LCD mode never spawns it', () => {
    const game = new SnakeGame();
    game.resetArena(5, ESnakeMaze.Open, 42);
    game.setFoodForTest(P(0, 0));
    game.setTransitionForTest(P(20, 20));
    for (let i = 0; i < SnakeGame.FoodsPerBonus; ++i) {
      const head = game.getHead();
      game.setFoodForTest(P(head.x + 1, head.y));
      game.step();
      expect(game.getFood()).not.toEqual(game.getTransitionPos());
    }
    expect(game.isBonusActive()).toBe(true);
    const bonus = game.getBonusPos();
    expect(game.getTransitionPos()).not.toEqual(bonus);
    expect(game.getTransitionPos()).not.toEqual(P(bonus.x + 1, bonus.y));
    game.clearTransition();
    expect(game.isTransitionActive()).toBe(false);

    game.reset(5, ESnakeMaze.Open, 42);
    expect(game.spawnTransition()).toBe(false);
    expect(game.isTransitionActive()).toBe(false);
  });
});

describe('SnakeGame extras', () => {
  it('enum values match the C++ ordering', () => {
    expect([ESnakeDir.Up, ESnakeDir.Down, ESnakeDir.Left, ESnakeDir.Right]).toEqual([0, 1, 2, 3]);
    expect([ESnakeMaze.Open, ESnakeMaze.Box, ESnakeMaze.Tunnel, ESnakeMaze.Mill, ESnakeMaze.Rails, ESnakeMaze.Count]).toEqual([0, 1, 2, 3, 4, 5]);
    expect(mazes.map(SnakeGame.getMazeName)).toEqual(['OPEN', 'BOX', 'TUNNEL', 'MILL', 'RAILS']);
    expect(SnakeGame.getMazeName(ESnakeMaze.Count)).toBe('?');
  });

  it('LCD walls come from the maze strings and all mazes are 23x13 with a clear spawn', () => {
    const game = new SnakeGame();
    for (const maze of mazes) {
      game.reset(5, maze, 1);
      expect(LCD_MAZES[maze]).toHaveLength(SnakeGame.LcdRows);
      for (let row = 0; row < SnakeGame.LcdRows; ++row) {
        expect(LCD_MAZES[maze][row]).toHaveLength(SnakeGame.LcdCols);
        for (let col = 0; col < SnakeGame.LcdCols; ++col) {
          expect(game.isWall(P(col, row))).toBe(LCD_MAZES[maze][row][col] === '#');
        }
      }
      for (let col = 2; col <= 12; ++col) expect(game.isWall(P(col, 6))).toBe(false);
      expect(game.isWall(game.getFood())).toBe(false);
    }
  });

  it('arena wall layouts', () => {
    const game = new SnakeGame();
    const wallCount = (maze: ESnakeMaze): number => {
      game.resetArena(5, maze, 1);
      let n = 0;
      for (let y = 0; y < SnakeGame.ArenaSize; ++y) for (let x = 0; x < SnakeGame.ArenaSize; ++x) n += game.isWall(P(x, y)) ? 1 : 0;
      return n;
    };
    expect(wallCount(ESnakeMaze.Open)).toBe(0);
    expect(wallCount(ESnakeMaze.Box)).toBe(4 * 18 - 4 - 4 * 4); // four 18-long bars, shared corners, 4-cell gaps
    expect(wallCount(ESnakeMaze.Tunnel)).toBe(2 * 14);
    expect(wallCount(ESnakeMaze.Mill)).toBe(7 + 8 + 7 + 8);
    expect(wallCount(ESnakeMaze.Rails)).toBe(3 * 2 * 6);
    game.resetArena(5, ESnakeMaze.Box, 1);
    expect(game.isWall(P(3, 3))).toBe(true);
    expect(game.isWall(P(11, 3))).toBe(false); // gap
    expect(game.isArena()).toBe(true);
    expect(game.inBounds(P(24, 0))).toBe(false);
    expect(game.isWall(P(-1, 5))).toBe(false);
  });

  it('turn queue buffers up to 3 and ignores repeats/reversals of the last queued dir', () => {
    const game = new SnakeGame();
    game.reset(5, ESnakeMaze.Open, 1);
    game.queueTurn(ESnakeDir.Right); // repeat
    expect(game.getQueuedDir()).toBe(ESnakeDir.Right);
    game.queueTurn(ESnakeDir.Up);
    game.queueTurn(ESnakeDir.Down); // reverses the queued Up
    expect(game.getQueuedDir()).toBe(ESnakeDir.Up);
    game.queueTurn(ESnakeDir.Left);
    game.queueTurn(ESnakeDir.Down);
    game.queueTurn(ESnakeDir.Right); // 4th, dropped
    expect(game.getQueuedDir()).toBe(ESnakeDir.Down);
    expect(game.getDir()).toBe(ESnakeDir.Right);
    game.setFoodForTest(P(0, 0));
    game.step();
    expect(game.getDir()).toBe(ESnakeDir.Up);
    expect(game.getHead()).toEqual(P(9, 5));
  });

  it('step interval ramps with level (and food in the arena)', () => {
    const game = new SnakeGame();
    game.reset(1, ESnakeMaze.Open, 1);
    expect(game.getStepInterval()).toBeCloseTo(0.4, 6);
    game.reset(9, ESnakeMaze.Open, 1);
    expect(game.getStepInterval()).toBeCloseTo(0.4 * Math.pow(0.84, 8), 6);
    game.reset(42, ESnakeMaze.Open, 1);
    expect(game.getLevel()).toBe(9);
    game.reset(-3, ESnakeMaze.Open, 1);
    expect(game.getLevel()).toBe(1);

    game.resetArena(5, ESnakeMaze.Open, 1);
    const base = 0.3 * Math.pow(0.88, 4);
    expect(game.getStepInterval()).toBeCloseTo(base, 6);
    game.setFoodForTest(P(9, 12));
    game.step();
    expect(game.getStepInterval()).toBeCloseTo(base * 0.985, 6);
  });

  it('LCD mode has no combo; arena combo remaining decays over the window', () => {
    const lcd = new SnakeGame();
    lcd.reset(5, ESnakeMaze.Open, 1);
    lcd.setFoodForTest(P(10, 6));
    lcd.step();
    lcd.setFoodForTest(P(11, 6));
    lcd.step();
    expect(lcd.getCombo()).toBe(1);
    expect(lcd.getScore()).toBe(10);
    expect(lcd.getComboRemaining()).toBe(0);

    const arena = new SnakeGame();
    arena.resetArena(3, ESnakeMaze.Open, 1);
    arena.setFoodForTest(P(9, 12));
    arena.step();
    expect(arena.getComboRemaining()).toBe(1);
    expect(arena.getLastPoints()).toBe(3);
    arena.setFoodForTest(P(0, 0));
    for (let i = 0; i < 4; ++i) arena.step();
    expect(arena.getComboRemaining()).toBeCloseTo(1 - 4 / 16, 6);
    arena.setFoodForTest(P(14, 12));
    arena.step();
    expect(arena.getCombo()).toBe(2);
    expect(arena.getLastPoints()).toBe(6);
  });

  it('a bonus critter appears every 5 foods and expires after BonusSteps', () => {
    const game = new SnakeGame();
    game.reset(5, ESnakeMaze.Open, 3);
    let events = 0;
    for (let i = 0; i < SnakeGame.FoodsPerBonus; ++i) {
      const head = game.getHead();
      game.setFoodForTest(P((head.x + 1) % SnakeGame.LcdCols, head.y));
      events = game.step();
      expect(events & SnakeEvents.Ate).not.toBe(0);
    }
    expect(events & SnakeEvents.BonusAppeared).not.toBe(0);
    expect(game.isBonusActive()).toBe(true);
    expect(game.getBonusTimer()).toBe(SnakeGame.BonusSteps);
    expect(game.getBonusKind()).toBeGreaterThanOrEqual(0);
    expect(game.getBonusKind()).toBeLessThan(SnakeGame.NumCritters);
    const bonus = game.getBonusPos();
    expect(bonus.x).toBeLessThan(SnakeGame.LcdCols - 1);

    // Steer off the snake's row so it can't accidentally eat the bonus: go up a row if the bonus is on ours.
    if (bonus.y === 6 || bonus.y === 5) game.queueTurn(ESnakeDir.Down);
    game.setFoodForTest(P(-5, -5));
    let expiredAt = -1;
    for (let i = 1; i <= SnakeGame.BonusSteps && expiredAt < 0; ++i) {
      const e = game.step();
      expect(e & SnakeEvents.AteBonus).toBe(0);
      if (e & SnakeEvents.BonusExpired) expiredAt = i;
      else expect(game.getBonusTimer()).toBe(SnakeGame.BonusSteps - i);
      if (game.getHead().y !== 6 && game.getDir() === ESnakeDir.Down) game.queueTurn(ESnakeDir.Right);
    }
    expect(expiredAt).toBe(SnakeGame.BonusSteps);
    expect(game.isBonusActive()).toBe(false);
  });

  it('eating the bonus pays (5*level + 2*timer) * combo', () => {
    let checked = 0;
    for (let seed = 0; seed < 20 && checked < 3; ++seed) {
      const game = new SnakeGame();
      game.resetArena(4, ESnakeMaze.Open, seed);
      for (let step = 0; step < 3000 && !game.isDead(); ++step) {
        game.queueTurn(game.chooseAutopilotDir());
        const timerBefore = game.getBonusTimer();
        const e = game.step();
        if (e & SnakeEvents.AteBonus) {
          expect(game.getLastPoints()).toBe((5 * 4 + 2 * timerBefore) * game.getCombo());
          expect(game.isBonusActive()).toBe(false);
          ++checked;
          break;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('is deterministic per seed and accepts an injected RNG', () => {
    const run = (make: () => SnakeGame): string => {
      const g = make();
      g.reset(5, ESnakeMaze.Tunnel, 77);
      const trace: string[] = [];
      for (let i = 0; i < 300 && !g.isDead(); ++i) {
        g.queueTurn(g.chooseAutopilotDir());
        g.step();
        trace.push(`${g.getFood().x},${g.getFood().y}`);
      }
      return trace.join(';');
    };
    expect(run(() => new SnakeGame())).toBe(run(() => new SnakeGame()));
    expect(run(() => new SnakeGame(new Mulberry32()))).toBe(run(() => new SnakeGame(new Mulberry32())));
  });

  it('dead snakes do not move', () => {
    const game = new SnakeGame();
    game.resetArena(5, ESnakeMaze.Open, 1);
    game.queueTurn(ESnakeDir.Up);
    game.setFoodForTest(P(0, 0));
    for (let i = 0; i < 20; ++i) game.step();
    expect(game.isDead()).toBe(true);
    const head = game.getHead();
    expect(game.step()).toBe(SnakeEvents.None);
    expect(game.getHead()).toEqual(head);
  });

  it('render: demo banner blinks, score is zero-padded, open mouth near food', () => {
    const game = new SnakeGame();
    game.reset(5, ESnakeMaze.Open, 5);
    const lit = (fb: LcdFramebuffer, y0: number, y1: number): number => {
      let n = 0;
      for (let y = y0; y < y1; ++y) for (let x = 0; x < LcdFramebuffer.Width; ++x) n += fb.get(x, y) ? 1 : 0;
      return n;
    };
    const on = new LcdFramebuffer();
    game.render(on, false, true, 0.1);
    const off = new LcdFramebuffer();
    game.render(off, false, true, 1.0);
    expect(lit(on, 0, 9)).toBeGreaterThan(0);
    expect(lit(off, 0, 9)).toBe(0);

    const score = new LcdFramebuffer();
    game.render(score, false, false, 0);
    const expected = new LcdFramebuffer();
    expected.drawText(1, 1, '0000');
    for (let y = 0; y < 9; ++y) for (let x = 0; x < 30; ++x) expect(score.get(x, y)).toBe(expected.get(x, y));

    game.setFoodForTest(P(10, 6));
    const mouth = new LcdFramebuffer();
    game.render(mouth, true, false, 0);
    const hx = SnakeGame.cellPixelX(9);
    const hy = SnakeGame.cellPixelY(6);
    expect(mouth.get(hx + 2, hy + 1)).toBe(0);
    expect(mouth.get(hx, hy)).toBe(135);
    expect(mouth.get(hx + 3, hy)).toBe(0); // no link on the head's leading side
    expect(mouth.get(hx - 1, hy)).toBe(LcdFramebuffer.On); // link towards the body
  });
});
