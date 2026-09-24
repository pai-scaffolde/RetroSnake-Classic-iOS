import { describe, expect, it } from 'vitest';
import {
  INDEX_NONE,
  SAVE_KEY,
  TableSize,
  addScore,
  createSave,
  getTable,
  loadSave,
  loadSaveFrom,
  qualifies,
  writeSave,
  writeSaveTo,
  type KeyValueStorage,
} from './SaveData.ts';
import { ESnakeMaze } from './SnakeGame.ts';

class FakeStorage implements KeyValueStorage {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe('high-score table (ported)', () => {
  it('top 5 per maze, best first, initials upper-cased', () => {
    const save = createSave();
    expect(save.topScores).toHaveLength(ESnakeMaze.Count);
    for (const score of [50, 10, 40, 20, 30]) addScore(save, 0, 'abc', score, 5);
    expect(qualifies(save, 0, 5)).toBe(false);
    expect(qualifies(save, 0, 15)).toBe(true);
    expect(qualifies(save, 1, 1)).toBe(true);
    expect(addScore(save, 0, 'ZED', 45, 6)).toBe(1);
    const table = getTable(save, 0);
    expect(table).toHaveLength(TableSize);
    expect(table[0].score).toBe(50);
    expect(table[table.length - 1].score).toBe(20);
    expect(table[1].name).toBe('ZED');
    expect(save.topScores[0]).toBe(50);
  });
});

describe('high-score table extras', () => {
  it('rejects zero, non-qualifying and keeps mazes separate', () => {
    const save = createSave();
    expect(qualifies(save, 2, 0)).toBe(false);
    expect(addScore(save, 2, 'X', 0, 5)).toBe(INDEX_NONE);
    expect(addScore(save, 2, 'robert', 12, 3)).toBe(0);
    expect(getTable(save, 2)[0]).toEqual({ maze: 2, name: 'ROB', score: 12, level: 3 });
    expect(getTable(save, 1)).toEqual([]);
    expect(save.topScores[2]).toBe(12);
    for (let i = 0; i < 5; ++i) addScore(save, 2, 'AAA', 100, 5);
    expect(qualifies(save, 2, 100)).toBe(false); // must beat the lowest, not tie it
    expect(getTable(save, 2).every((e) => e.score === 100)).toBe(true);
  });

  it('a tie keeps the older entry first (stable sort), like the C++', () => {
    const save = createSave();
    addScore(save, 0, 'OLD', 30, 5);
    expect(addScore(save, 0, 'NEW', 30, 5)).toBe(1);
    expect(getTable(save, 0).map((e) => e.name)).toEqual(['OLD', 'NEW']);
  });

  it('getTable returns copies', () => {
    const save = createSave();
    addScore(save, 0, 'ABC', 10, 5);
    getTable(save, 0)[0].score = 999;
    expect(getTable(save, 0)[0].score).toBe(10);
  });
});

describe('persistence', () => {
  it('round-trips through storage', () => {
    const storage = new FakeStorage();
    const save = createSave();
    save.level = 7;
    save.maze = 3;
    save.cover = 2;
    save.scene = 2;
    save.soundOn = false;
    save.classicCamera = true;
    save.quality = 1;
    save.lastName = 'GRY';
    addScore(save, 3, 'gry', 120, 7);
    expect(writeSaveTo(save, storage)).toBe(true);
    expect(storage.data.has(SAVE_KEY)).toBe(true);
    expect(loadSaveFrom(storage)).toEqual(save);
  });

  it('missing, corrupt or absent storage yields defaults', () => {
    expect(loadSaveFrom(null)).toEqual(createSave());
    expect(loadSaveFrom(new FakeStorage())).toEqual(createSave());
    const corrupt = new FakeStorage();
    corrupt.setItem(SAVE_KEY, '{not json');
    expect(loadSaveFrom(corrupt)).toEqual(createSave());
    corrupt.setItem(SAVE_KEY, '[1,2,3]');
    expect(loadSaveFrom(corrupt)).toEqual(createSave());
    const throwing: KeyValueStorage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('quota'); },
    };
    expect(loadSaveFrom(throwing)).toEqual(createSave());
    expect(writeSaveTo(createSave(), throwing)).toBe(false);
    expect(writeSaveTo(createSave(), null)).toBe(false);
  });

  it('normalises out-of-range and wrongly typed fields like GetSave()', () => {
    const storage = new FakeStorage();
    storage.setItem(SAVE_KEY, JSON.stringify({
      level: 99, maze: -4, cover: 12, scene: 8, soundOn: 'yes', classicCamera: true, quality: 9,
      topScores: [5, 'x', 7, 1, 2, 3, 4, 8], lastName: 42,
      leaderboard: [{ maze: 1, name: 'ABC', score: 10, level: 2 }, { maze: 1, score: 'bad' }, null],
    }));
    const save = loadSaveFrom(storage);
    expect(save.level).toBe(9);
    expect(save.maze).toBe(0);
    expect(save.cover).toBe(3);
    expect(save.scene).toBe(3);
    expect(save.soundOn).toBe(true);
    expect(save.classicCamera).toBe(true);
    expect(save.quality).toBe(3);
    expect(save.topScores).toEqual([5, 0, 7, 1, 2]);
    expect(save.lastName).toBe('AAA');
    expect(save.leaderboard).toEqual([{ maze: 1, name: 'ABC', score: 10, level: 2 }]);

    storage.setItem(SAVE_KEY, JSON.stringify({ topScores: [3] }));
    expect(loadSaveFrom(storage).topScores).toEqual([3, 0, 0, 0, 0]);
    expect(loadSaveFrom(storage).quality).toBeUndefined();
    expect(loadSaveFrom(storage).scene).toBe(0);
  });

  it('loadSave/writeSave work without localStorage (node) and honour skip', () => {
    expect(loadSave()).toEqual(createSave());
    expect(() => writeSave(createSave())).not.toThrow();

    const storage = new FakeStorage();
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
    try {
      const save = createSave();
      save.level = 2;
      writeSave(save, true);
      expect(storage.data.size).toBe(0);
      writeSave(save);
      expect(storage.data.has(SAVE_KEY)).toBe(true);
      expect(loadSave().level).toBe(2);
    } finally {
      if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });
});
