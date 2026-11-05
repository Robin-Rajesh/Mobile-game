// Renders PNG app icons from client/public/icon.svg with Playwright's Chromium.
// Usage: node scripts/icons.cjs   (needs `playwright` resolvable, e.g. NODE_PATH=$(npm root -g))
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const pub = join(__dirname, '..', 'client', 'public');
  const svg = readFileSync(join(pub, 'icon.svg'), 'utf8');
  const browser = await chromium.launch();
  for (const size of [192, 512, 1024]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<style>html,body{margin:0;background:#120B1F}</style>${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}`);
    await page.screenshot({ path: join(pub, `icon-${size}.png`) });
    await page.close();
  }
  await browser.close();
  console.log('icons written');
})();
