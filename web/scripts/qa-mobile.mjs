import { webkit, devices } from 'playwright';

const browser = await webkit.launch({ headless: true });
const page = await browser.newPage({ ...devices['iPhone 16'], viewport: { width: 393, height: 852 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

try {
  await page.goto(process.env.RETROSNAKE_QA_URL ?? 'http://127.0.0.1:4179/', { waitUntil: 'domcontentloaded' });
  await page.locator('#loader.ready').waitFor({ timeout: 30000 });
  await page.locator('#loader').tap();
  await page.locator('#loader').waitFor({ state: 'detached', timeout: 10000 });
  await page.locator('.arena-hud.era-0').waitFor({ timeout: 30000 });
  await page.waitForTimeout(2500);
  const result = await page.evaluate(() => ({
    title: document.title,
    canvas: { width: document.querySelector('canvas')?.width, height: document.querySelector('canvas')?.height },
    era: document.querySelector('.ah-year')?.textContent,
    gameover: !!document.querySelector('.ah-gameover'),
    retry: !!document.querySelector('[data-k="retry"]'),
    desk: !!document.querySelector('.desk-hud'),
  }));
  await page.screenshot({ path: process.env.RETROSNAKE_QA_SHOT ?? '/private/tmp/retrosnake-classic-mobile.png' });
  await page.locator('.ah-gameover.on').waitFor({ timeout: 30000 });
  const finalScore = await page.locator('[data-k="finalScore"]').textContent();
  await page.getByRole('button', { name: 'PLAY AGAIN' }).tap();
  await page.locator('.ah-gameover.on').waitFor({ state: 'hidden', timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('.ah-year')?.textContent === '2001', { timeout: 30000 });
  const retryEra = await page.locator('.ah-year').textContent();
  console.log(JSON.stringify({ result, finalScore, retryEra, errors }, null, 2));
  if (!result.canvas.width || result.era !== '2001' || !result.retry || result.desk || retryEra !== '2001' || errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
