// RetroSnake - settings + high-score table. Port of URetroSnakeSaveGame (RetroSnakeGameMode.*)
// and the load-time normalisation in URetroSnakeGameInstance::GetSave().

import { ESnakeMaze, SnakeGame } from './SnakeGame.ts';

/** One line of the high-score table (FRetroScoreEntry). */
export interface ScoreEntry {
  maze: number;
  name: string;
  score: number;
  level: number;
}

export interface SaveData {
  level: number;
  maze: number;
  cover: number;
  /** Menu scene: 2001, Present, Future, or the phone's Classic LCD game. */
  scene: number;
  soundOn: boolean;
  /** Start arena runs in the top-down classic camera instead of the chase camera. */
  classicCamera: boolean;
  /** Web-only renderer quality tier (0..3); absent = let the renderer pick. Not part of the UE save. */
  quality?: number;
  /** Best score per maze, indexed by ESnakeMaze. */
  topScores: number[];
  /** Top entries (with initials) across all mazes; at most TableSize per maze. */
  leaderboard: ScoreEntry[];
  /** Initials last entered, offered as the default next time. */
  lastName: string;
}

export const TableSize = 5;
/** UE's INDEX_NONE. */
export const INDEX_NONE = -1;
export const SAVE_KEY = 'retrosnake.save.v1';
/** Phone faceplates (ARetroPhone GCoverNames); save.cover indexes this. */
export const COVER_NAMES: readonly string[] = ['Navy', 'Flames', 'Camo', 'Ice'];
export const NumCovers = COVER_NAMES.length;

/** Minimal Storage subset so tests can pass a fake and node works without localStorage. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** A fresh save, as returned by CreateSaveGameObject + GetSave() normalisation. */
export function createSave(): SaveData {
  return {
    level: 5,
    maze: 0,
    cover: 0,
    scene: 0,
    soundOn: true,
    classicCamera: false,
    topScores: new Array<number>(ESnakeMaze.Count).fill(0),
    leaderboard: [],
    lastName: 'AAA',
  };
}

/** Per-character upper-casing (keeps the length, like FString::ToUpper). */
function toUpperPerChar(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; ++i) {
    const up = s[i].toUpperCase();
    out += up.length === 1 ? up : s[i];
  }
  return out;
}

/** The maze's table, best first (copies). */
export function getTable(save: SaveData, inMaze: number): ScoreEntry[] {
  // Array.prototype.sort is stable, matching TArray::StableSort.
  const table = save.leaderboard.filter((e) => e.maze === inMaze).map((e) => ({ ...e }));
  table.sort((a, b) => b.score - a.score);
  if (table.length > TableSize) {
    table.length = TableSize;
  }
  return table;
}

/** Would this score make the maze's table? */
export function qualifies(save: SaveData, inMaze: number, score: number): boolean {
  const table = getTable(save, inMaze);
  return score > 0 && (table.length < TableSize || score > table[table.length - 1].score);
}

/** Insert a score, trim the table, update topScores. Returns its rank (0-based) or INDEX_NONE (-1) if it didn't place. */
export function addScore(save: SaveData, inMaze: number, name: string, score: number, inLevel: number): number {
  if (!qualifies(save, inMaze, score)) {
    return INDEX_NONE;
  }
  const entry: ScoreEntry = { maze: inMaze, name: toUpperPerChar(name.slice(0, 3)), score, level: inLevel };
  save.leaderboard.push(entry);

  // Keep only the best TableSize per maze. (Rank is the first entry with this score + name.)
  const table = getTable(save, inMaze);
  save.leaderboard = save.leaderboard.filter((e) => e.maze !== inMaze);
  let rank = INDEX_NONE;
  for (let index = 0; index < table.length; ++index) {
    save.leaderboard.push(table[index]);
    if (rank === INDEX_NONE && table[index].score === score && table[index].name === entry.name) {
      rank = index;
    }
  }
  if (inMaze >= 0 && inMaze < save.topScores.length) {
    save.topScores[inMaze] = Math.max(save.topScores[inMaze], score);
  }
  return rank;
}

// ---------------------------------------------------------------- persistence

function defaultStorage(): KeyValueStorage | null {
  try {
    // Node 25 exposes a method-less `localStorage` object unless --localstorage-file is given.
    const ls = (globalThis as { localStorage?: Partial<KeyValueStorage> }).localStorage;
    return ls && typeof ls.getItem === 'function' && typeof ls.setItem === 'function' ? (ls as KeyValueStorage) : null;
  } catch {
    return null; // e.g. SecurityError when storage is disabled
  }
}

function asInt(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback;
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validates arbitrary parsed JSON into a SaveData, then applies GetSave()'s normalisation. */
export function normalizeSave(raw: unknown): SaveData {
  const save = createSave();
  if (isRecord(raw)) {
    save.level = asInt(raw.level, save.level);
    save.maze = asInt(raw.maze, save.maze);
    save.cover = asInt(raw.cover, save.cover);
    save.scene = asInt(raw.scene, save.scene);
    save.soundOn = asBool(raw.soundOn, save.soundOn);
    save.classicCamera = asBool(raw.classicCamera, save.classicCamera);
    if (typeof raw.quality === 'number' && Number.isFinite(raw.quality)) {
      save.quality = clamp(Math.trunc(raw.quality), 0, 3);
    }
    if (typeof raw.lastName === 'string') {
      save.lastName = raw.lastName;
    }
    if (Array.isArray(raw.topScores)) {
      save.topScores = raw.topScores.map((v: unknown) => asInt(v, 0));
    }
    if (Array.isArray(raw.leaderboard)) {
      save.leaderboard = [];
      for (const e of raw.leaderboard as unknown[]) {
        if (isRecord(e) && typeof e.name === 'string' && typeof e.score === 'number' && Number.isFinite(e.score)) {
          save.leaderboard.push({ maze: asInt(e.maze, 0), name: e.name, score: Math.trunc(e.score), level: asInt(e.level, 5) });
        }
      }
    }
  }
  // TopScores.SetNumZeroed(Count): truncate or zero-extend.
  const top = new Array<number>(ESnakeMaze.Count).fill(0);
  for (let i = 0; i < top.length && i < save.topScores.length; ++i) {
    top[i] = save.topScores[i];
  }
  save.topScores = top;
  save.level = clamp(save.level, 1, SnakeGame.MaxLevel);
  save.maze = clamp(save.maze, 0, ESnakeMaze.Count - 1);
  save.cover = clamp(save.cover, 0, NumCovers - 1);
  save.scene = clamp(save.scene, 0, 3);
  return save;
}

/** Loads the save from the given storage; missing, corrupt or unavailable storage yields a fresh default save. */
export function loadSaveFrom(storage: KeyValueStorage | null): SaveData {
  if (!storage) {
    return createSave();
  }
  try {
    const text = storage.getItem(SAVE_KEY);
    return normalizeSave(text ? (JSON.parse(text) as unknown) : null);
  } catch {
    return createSave();
  }
}

/** Persists the save to the given storage. Returns false if unavailable or the write failed (quota, privacy mode...). */
export function writeSaveTo(save: SaveData, storage: KeyValueStorage | null): boolean {
  if (!storage) {
    return false;
  }
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

/** Loads from localStorage (key SAVE_KEY). Never throws; falls back to defaults. */
export function loadSave(): SaveData {
  return loadSaveFrom(defaultStorage());
}

/**
 * Writes to localStorage. skip = true mirrors URetroSnakeGameInstance::WriteSave refusing to persist
 * during scripted / demo / autoplay runs. Never throws.
 */
export function writeSave(save: SaveData, skip = false): void {
  if (!skip) {
    writeSaveTo(save, defaultStorage());
  }
}
