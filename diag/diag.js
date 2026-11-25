// Abre la app publicada con datos reales y registra qué falla.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
  const page = await ctx.newPage();
  const reqs = {};
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log('[consola]', m.type(), m.text().slice(0, 300)); });
  page.on('pageerror', (e) => console.log('[error de página]', e.message));
  page.on('requestfailed', (r) => console.log('[petición fallida]', r.url().slice(0, 140), r.failure()?.errorText));
  page.on('response', (r) => { const h = new URL(r.url()).host; const k = `${h} ${r.status()}`; reqs[k] = (reqs[k] || 0) + 1; if (r.status() >= 400) console.log('[HTTP]', r.status(), r.url().slice(0, 140)); });
  await page.goto('https://tomytpo.github.io/meson-de-aragon/?diag=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(30000);
  console.log('ESTADO:', await page.textContent('#liveText'));
  console.log('FILAS RADAR:', await page.$$eval('#radarList .row-t', (e) => e.length));
  console.log('TEXTO RADAR:', (await page.textContent('#radarList')).trim().slice(0, 200));
  if (await page.$('#radarList .row-t')) {
    await page.click('#radarList .row-t');
    await page.waitForTimeout(8000);
    console.log('VELAS:', (await page.textContent('#chart')).trim().slice(0, 200) || '(gráfico dibujado)');
    console.log('CANVAS:', await page.$$eval('#chart canvas', (e) => e.length));
    await page.click('#sheetClose');
  }
  await page.click('.tab[data-v=top]'); await page.waitForTimeout(3000);
  console.log('FILAS CRIPTO TOP:', await page.$$eval('#topList .row-t', (e) => e.length));
  await page.click('.tab[data-v=stocks]'); await page.waitForTimeout(3000);
  console.log('FILAS BOLSA:', await page.$$eval('#stkList .row-t', (e) => e.length));
  await page.click('.tab[data-v=settings]');
  console.log('DIAGNÓSTICO APP:', await page.textContent('#diag'), '|', await page.textContent('#appVersion'));
  console.log('RESPUESTAS POR HOST/ESTADO:', JSON.stringify(reqs, null, 1));
  await b.close();
})();
