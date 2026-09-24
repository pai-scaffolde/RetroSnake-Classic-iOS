import { webkit } from 'playwright';

const url = process.env.RETROSNAKE_QA_URL ?? 'http://127.0.0.1:4180/?qa&webgl';
const browser = await webkit.launch({ headless: true });

try {
  for (const quality of [1, 3]) {
    const context = await browser.newContext({
      viewport: { width: 428, height: 926 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    await context.addInitScript((tier) => {
      localStorage.setItem('retrosnake.save.v1', JSON.stringify({ quality: tier }));
    }, quality);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator('#loader').waitFor({ state: 'detached', timeout: 60000 });
    const metrics = await page.evaluate(() => {
      const canvas = document.querySelector('#view');
      return {
        cssWidth: canvas.clientWidth,
        cssHeight: canvas.clientHeight,
        width: canvas.width,
        height: canvas.height,
        devicePixelRatio: window.devicePixelRatio,
        quality: window.retrosnake.engine.quality,
        backend: window.retrosnake.engine.backendName,
      };
    });
    await page.screenshot({ path: `/private/tmp/voxel-snake-retina-${quality}.png` });
    await page.evaluate(() => window.retrosnake.input.emit('select', 'touch'));
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `/private/tmp/voxel-snake-retina-gameplay-${quality}.png` });
    const frameMs = await page.evaluate(() => {
      const frames = window.retrosnake.engine.frameTimes.slice(-60);
      return {
        average: frames.reduce((sum, frame) => sum + frame, 0) / frames.length,
        worst: Math.max(...frames),
      };
    });
    console.log(JSON.stringify({ metrics, frameMs, errors }));
    if (errors.length || metrics.width < metrics.cssWidth * (quality === 3 ? 2.9 : 1.4)) {
      process.exitCode = 1;
    }
    await context.close();
  }
} finally {
  await browser.close();
}
