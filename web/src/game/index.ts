// RetroSnake pure game logic: no DOM, no three.js. Usable from node tests and the renderer.
export {
  SnakeGame,
  ESnakeDir,
  ESnakeMaze,
  SnakeEvents,
  LCD_MAZES,
  CRITTERS,
  HeadHeight,
  FoodHeight,
  WallHeight,
  type IntPoint,
} from './SnakeGame.ts';
export { LcdFramebuffer, GLYPHS, findGlyph } from './LcdFramebuffer.ts';
export { RandomStream, Mulberry32, randomSeed, type SnakeRng } from './Random.ts';
export {
  createSave,
  getTable,
  qualifies,
  addScore,
  normalizeSave,
  loadSave,
  writeSave,
  loadSaveFrom,
  writeSaveTo,
  TableSize,
  INDEX_NONE,
  SAVE_KEY,
  COVER_NAMES,
  NumCovers,
  type SaveData,
  type ScoreEntry,
  type KeyValueStorage,
} from './SaveData.ts';
