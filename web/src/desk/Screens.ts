// Every screen the phone can show, drawn into the 95x64 framebuffer (RetroSnakePlayerController Draw*).
import { LcdFramebuffer, SnakeGame, getTable, type SaveData } from '../game';

const W = LcdFramebuffer.Width;
const H = LcdFramebuffer.Height;
const On = LcdFramebuffer.On;

const pad4 = (n: number) => String(Math.max(0, Math.trunc(n))).padStart(4, '0');

/** Title card: a little snake chases its tail around the edge of the screen. */
export function drawAttract(fb: LcdFramebuffer, clock: number, ringing: boolean, topScore: number, touch: boolean): void {
  const L = 1, T = 1, R = W - 2, B = H - 2;
  const perimeter = 2 * (R - L) + 2 * (B - T);
  const head = Math.floor(clock * 45);
  for (let segment = 0; segment < 34; ++segment) {
    let p = (((head - segment) % perimeter) + perimeter) % perimeter;
    let x: number, y: number;
    if (p < R - L) { x = L + p; y = T; }
    else if ((p -= R - L) < B - T) { x = R; y = T + p; }
    else if ((p -= B - T) < R - L) { x = R - p; y = B; }
    else { p -= R - L; x = L; y = B - p; }
    fb.set(x, y, segment === 0 ? 135 : On);
  }
  fb.drawTextCentered(9, 'SNAKE', 3, 115);
  if (clock % 1.2 < 0.8) {
    fb.drawTextCentered(38, touch ? (ringing ? 'TAP TO ANSWER' : 'TAP TO START') : ringing ? 'PRESS ANY KEY' : 'PRESS 5');
  }
  fb.drawTextCentered(51, `TOP ${pad4(topScore)}`);
}

export type Row = readonly [label: string, value: string];

/** Nokia-style list: title bar, highlighted row, scroll bar. Returns the new scroll offset. */
export function drawList(fb: LcdFramebuffer, title: string, rows: readonly Row[], selected: number, scroll: number): number {
  const visibleRows = 6;
  fb.drawText(1, 1, title);
  fb.drawTextRight(93, 1, String(selected + 1));
  fb.fillRect(0, 9, W, 1);
  // Keep the highlighted row on screen, the way phone menus scrolled.
  scroll = Math.min(Math.max(scroll, selected - visibleRows + 1), selected);
  scroll = Math.min(Math.max(scroll, 0), Math.max(0, rows.length - visibleRows));
  for (let row = 0; row < visibleRows && scroll + row < rows.length; ++row) {
    const index = scroll + row;
    const y = 12 + 9 * row;
    const isSelected = index === selected;
    // In voxels an inverted bar breaks up into dots and the punched-out letters get lost, so the selected row is
    // framed instead, with its letters raised a little taller so they catch the light.
    const ink = isSelected ? 125 : On;
    if (isSelected) fb.rectOutline(0, y - 2, 91, 11, 70);
    fb.drawText(3, y, rows[index][0], 1, ink);
    const value = rows[index][1];
    if (value) fb.drawTextRight(88, y, isSelected ? `<${value}>` : value, 1, ink);
  }
  for (let y = 11; y < H; y += 2) fb.set(93, y);
  const track = H - 11;
  const thumbH = Math.max(4, Math.trunc(track / Math.max(1, rows.length)));
  const thumbY = 11 + (rows.length > 1 ? Math.trunc(((track - thumbH) * selected) / (rows.length - 1)) : 0);
  fb.fillRect(92, thumbY, 3, thumbH);
  return scroll;
}

const AboutLines = [
  'RETROSNAKE', '', 'A 2001 CLASSIC', 'REBORN IN 3D', '',
  'MADE BY A TEAM', 'OF AI AGENTS', '',
  'CLAUDE DIRECTED', 'SPECIALISTS:', '',
  'ART DIRECTOR', 'BLENDER ARTIST', 'TEXTURE ARTIST', 'AUDIO DESIGNER', 'GAME ENGINEER', 'WEB ENGINEERS', 'QA TESTER', '',
  'BUILT WITH', 'BLENDER AND', 'THREE.JS', '',
  'THANKS FOR', 'PLAYING!', '', '', '',
];

/** Slow credits roll, like the phone's "about" screen. */
export function drawAbout(fb: LcdFramebuffer, stateTime: number): void {
  const lineHeight = 10;
  const total = AboutLines.length * lineHeight;
  const offset = Math.floor(stateTime * 9) % (total + H);
  for (let index = 0; index < AboutLines.length; ++index) {
    const y = H + index * lineHeight - offset;
    if (y > -8 && y < H) fb.drawTextCentered(y, AboutLines[index], 1, index === 0 ? 125 : On);
  }
}

export function drawTopScores(fb: LcdFramebuffer, save: SaveData, maze: number, highlightRank: number, stateTime: number): void {
  fb.drawText(1, 1, 'TOP ' + SnakeGame.getMazeName(maze));
  fb.drawTextRight(93, 1, '<>');
  fb.fillRect(0, 9, W, 1);
  const table = getTable(save, maze);
  if (table.length === 0) {
    fb.drawTextCentered(30, 'NO SCORES YET');
    return;
  }
  for (let rank = 0; rank < table.length; ++rank) {
    const y = 12 + 10 * rank;
    const highlight = rank === highlightRank && stateTime % 0.8 < 0.55;
    const ink = highlight ? 125 : On;
    if (highlight) fb.rectOutline(0, y - 2, W, 11, 70);
    fb.drawText(2, y, `${rank + 1} ${table[rank].name}`, 1, ink);
    fb.drawTextRight(92, y, pad4(table[rank].score), 1, ink);
  }
}

/** Arcade-style initials: three big letters, the active one blinking an underline. */
export function drawEnterName(fb: LcdFramebuffer, score: number, name: string, cursor: number, stateTime: number): void {
  fb.drawTextCentered(1, 'NEW HIGH SCORE');
  fb.drawTextCentered(12, pad4(score), 2, 120);
  fb.drawTextCentered(31, 'ENTER NAME');
  const letterStep = 14;
  const x0 = Math.trunc((W - (letterStep * 2 + LcdFramebuffer.GlyphW * 2)) / 2);
  for (let index = 0; index < 3; ++index) {
    const x = x0 + index * letterStep;
    fb.drawText(x, 42, name[index] ?? 'A', 2, index === cursor ? 125 : On);
    if (index === cursor && stateTime % 0.6 < 0.4) fb.fillRect(x, 58, LcdFramebuffer.GlyphW * 2, 2, 125);
  }
}

export function drawPaused(fb: LcdFramebuffer, game: SnakeGame, clock: number): void {
  game.render(fb, true, false, clock);
  fb.fillRect(8, 21, 79, 24, 0);
  fb.rectOutline(8, 21, 79, 24);
  fb.rectOutline(10, 23, 75, 20);
  fb.drawTextCentered(26, 'PAUSED');
  fb.drawTextCentered(35, '5 GO  C QUIT');
}

export function drawGameOver(fb: LcdFramebuffer, score: number, newRecord: boolean, topScore: number, stateTime: number): void {
  fb.drawTextCentered(4, 'GAME OVER!');
  fb.drawTextCentered(20, 'YOUR SCORE:');
  fb.drawTextCentered(31, String(score), 2, 120);
  if (newRecord && stateTime % 0.8 < 0.5) {
    fb.drawTextCentered(52, 'NEW TOP SCORE!');
  } else if (!newRecord) {
    fb.drawTextCentered(52, `TOP ${pad4(topScore)}`);
  }
}
