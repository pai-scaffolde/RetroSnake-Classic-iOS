import { webkit } from 'playwright';

const browser = await webkit.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 428, height: 926 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(() => {
    localStorage.setItem('retrosnake.save.v1', JSON.stringify({ quality: 3 }));
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.RETROSNAKE_QA_URL ?? 'http://127.0.0.1:4180/?scene=arena&qa&webgl', {
    waitUntil: 'domcontentloaded',
  });
  await page.locator('#loader').waitFor({ state: 'detached', timeout: 120000 });
  await page.locator('.arena-hud.era-0').waitFor({ state: 'visible' });
  await page.waitForTimeout(5500);
  const state = await page.evaluate(() => {
    const game = window.retrosnake;
    const canvas = document.querySelector('#view');
    const arena = window.__arena;
    const frames = game.engine.frameTimes.slice(-60);
    return {
      quality: game.engine.quality,
      modelLod: arena.models.detail,
      era: arena.era,
      arenaState: arena.state,
      canvasWidth: canvas.width,
      cssWidth: canvas.clientWidth,
      avgFrameMs: frames.reduce((sum, value) => sum + value, 0) / frames.length,
      hud: !!document.querySelector('.arena-hud.era-0'),
      models: Object.keys(game.assets.manifest.models ?? {}).length,
    };
  });
  await page.screenshot({ path: '/private/tmp/voxel-snake-arena-retina.png' });
  console.log(JSON.stringify({ state, errors }));
  if (errors.length || !state.hud || state.quality !== 3 || state.modelLod !== 0 ||
      state.canvasWidth !== state.cssWidth * 3 || !state.models || state.era !== 0) {
    process.exitCode = 1;
  }
  for (const era of [1, 2]) {
    await page.evaluate((nextEra) => window.__arena.shiftToEra(nextEra), era);
    await page.waitForTimeout(2800);
    await page.locator(`.arena-hud.era-${era}`).waitFor({ state: 'visible' });
    await page.screenshot({ path: `/private/tmp/voxel-snake-arena-era-${era}.png` });
  }
  await context.close();

  const playContext = await browser.newContext({
    viewport: { width: 428, height: 926 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  await playContext.addInitScript(() => {
    localStorage.setItem('retrosnake.save.v1', JSON.stringify({ quality: 3, level: 1, maze: 0 }));
  });
  const playPage = await playContext.newPage();
  playPage.on('pageerror', (error) => errors.push(error.message));
  await playPage.goto('http://127.0.0.1:4180/?scene=arena&webgl', { waitUntil: 'domcontentloaded' });
  await playPage.locator('#loader.ready').waitFor({ state: 'visible', timeout: 120000 });
  await playPage.locator('#loader').click();
  await playPage.locator('#loader').waitFor({ state: 'detached', timeout: 10000 });
  await playPage.locator('.ah-steer.on').waitFor({ state: 'visible', timeout: 10000 });
  await playPage.getByRole('button', { name: 'Turn left' }).click();
  await playPage.getByRole('button', { name: 'Pause' }).click();
  await playPage.locator('.ah-pause.on').waitFor({ state: 'visible' });
  await playPage.getByRole('button', { name: 'END RUN' }).click();
  await playPage.locator('.ah-gameover.on').waitFor({ state: 'visible', timeout: 10000 });
  await playPage.getByRole('button', { name: 'PLAY AGAIN' }).click();
  await playPage.locator('.arena-hud.era-0').waitFor({ state: 'visible', timeout: 120000 });
  console.log(JSON.stringify({ interactive: 'turn, pause, end run, retry', errors }));
  if (errors.length) process.exitCode = 1;
  await playContext.close();
} finally {
  await browser.close();
}
