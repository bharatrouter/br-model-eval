/*
 * Cross-browser / cross-device / cross-theme sweep for the benchmark report page.
 *   node test/crossbrowser.mjs
 * Wraps charts/br-benchmark.html (the artifact body) in a minimal shell mirroring the
 * Artifact wrapper, then loads it in chromium/firefox/webkit × desktop/tablet/mobile ×
 * light/dark. Per combo asserts: no console/page errors, NO horizontal overflow (body must
 * never scroll sideways), and that the JS-rendered pieces exist — frontier SVG, stat tiles,
 * axis matrix, verbosity bars. Screenshots to test/shots/. Also renders hero.svg per engine.
 */
import { chromium, firefox, webkit } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'test', 'shots');
mkdirSync(OUT, { recursive: true });

// wrap the artifact body in the same skeleton the Artifact host uses
const body = readFileSync(join(ROOT, 'charts', 'br-benchmark.html'), 'utf8');
const wrapped = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}body{margin:0}</style></head><body>${body}</body></html>`;
const pagePath = join(ROOT, 'test', '_report.html');
writeFileSync(pagePath, wrapped);
const url = 'file://' + pagePath;
const heroUrl = 'file://' + join(ROOT, 'charts', 'hero.svg');

const engines = { chromium, firefox, webkit };
const viewports = {
  desktop: { width: 1366, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
};
const SELECTORS = ['#frontier circle', '#tiles .tile', '#matrix tbody tr', '#verbosity div'];

const issues = [], okrows = [];

for (const [ename, launcher] of Object.entries(engines)) {
  const browser = await launcher.launch();
  for (const [vname, vp] of Object.entries(viewports)) {
    for (const scheme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      const errs = [];
      page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });
      page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message.slice(0, 140)));
      const tag = `${ename}/${vname}/${scheme}`;
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
        await page.waitForTimeout(200); // let the inline chart script paint
        // horizontal overflow check — the body must never scroll sideways
        const overflow = await page.evaluate(() => ({
          docW: document.documentElement.scrollWidth,
          winW: window.innerWidth,
        }));
        const hoverflow = overflow.docW - overflow.winW;
        if (hoverflow > 2) issues.push(`${tag}: horizontal overflow ${hoverflow}px (doc ${overflow.docW} > win ${overflow.winW})`);
        // rendered pieces present
        for (const sel of SELECTORS) {
          const n = await page.locator(sel).count();
          if (n === 0) issues.push(`${tag}: missing ${sel}`);
        }
        if (errs.length) issues.push(`${tag}: console/page errors → ${errs.join(' | ')}`);
        await page.screenshot({ path: join(OUT, `report-${ename}-${vname}-${scheme}.png`), fullPage: true });
        okrows.push(`${tag}  overflow=${hoverflow}px  tiles=${await page.locator('#tiles .tile').count()}  axes=${await page.locator('#matrix tbody tr').count()}  bars=${await page.locator('#verbosity div').count()}`);
      } catch (e) {
        issues.push(`${tag}: LOAD FAILED ${String(e.message).slice(0, 120)}`);
      }
      await ctx.close();
    }
  }
  // hero.svg once per engine (fixed-size infographic)
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 } });
  const page = await ctx.newPage();
  try {
    await page.goto(heroUrl, { waitUntil: 'load', timeout: 15000 });
    await page.screenshot({ path: join(OUT, `hero-${ename}.png`) });
    okrows.push(`${ename}/hero rendered`);
  } catch (e) { issues.push(`${ename}/hero: ${String(e.message).slice(0, 100)}`); }
  await ctx.close();
  await browser.close();
}

console.log('\n=== PASS ===');
for (const r of okrows) console.log('  ✓ ' + r);
console.log(`\n=== ISSUES (${issues.length}) ===`);
for (const i of issues) console.log('  ✗ ' + i);
console.log(`\nscreenshots: test/shots/  (${okrows.length} combos)`);
process.exit(issues.length ? 1 : 0);
