// Ejecutar: node --test tests/analysis.test.js
const test = require("node:test");
const assert = require("node:assert");
const A = require("../app/analysis.js");

function serie(n, f) {
  let p = 1; const c = [];
  for (let i = 0; i < n; i++) {
    const o = p; p = p * (1 + f(i));
    c.push({ time: i, open: o, high: Math.max(o, p) * 1.01, low: Math.min(o, p) * 0.99, close: p, volume: 100 });
  }
  return c;
}

test("tendencia alcista con soportes debajo", () => {
  const r = A.analyze(serie(200, (i) => Math.sin(i / 9) * 0.03 + (i > 150 ? 0.02 : 0)));
  assert.strictEqual(r.bias, "up");
  assert.ok(r.supports.length > 0);
  assert.ok(r.supports.every((s) => s < r.price));
});

test("tendencia bajista con resistencias encima", () => {
  const r = A.analyze(serie(120, (i) => -0.01 + Math.sin(i / 5) * 0.02));
  assert.strictEqual(r.bias, "down");
  assert.ok(r.resistances.length > 0);
  assert.ok(r.resistances.every((x) => x > r.price));
});

test("pocas velas no da estimación", () => {
  assert.strictEqual(A.analyze(serie(10, () => 0.01)), null);
});

test("riesgos de contexto", () => {
  const r = A.analyze(serie(100, () => 0.01), { ageH: 5, liquidity: 10000, mcap: 500000, change24h: 500 });
  assert.ok(r.risks.length >= 3);
});

test("RSI en rango 0-100", () => {
  const closes = serie(100, (i) => Math.sin(i) * 0.05).map((k) => k.close);
  A.rsi(closes).filter((x) => x != null).forEach((x) => assert.ok(x >= 0 && x <= 100));
});

test("formato de precios pequeños", () => {
  assert.strictEqual(A.fmt(0.000674), "$0.000674");
  assert.strictEqual(A.fmt(90123), "$90,123");
});
