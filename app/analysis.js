/* Motor de análisis técnico: indicadores, niveles y estimación a partir de velas.
   Velas: [{time (s), open, high, low, close, volume}] en orden cronológico. */
(function (root) {
  "use strict";

  function ema(vals, n) {
    const k = 2 / (n + 1);
    const out = [];
    let prev;
    vals.forEach((v, i) => { prev = i === 0 ? v : v * k + prev * (1 - k); out.push(prev); });
    return out;
  }

  function rsi(closes, n = 14) {
    const out = new Array(closes.length).fill(null);
    if (closes.length <= n) return out;
    let g = 0, l = 0;
    for (let i = 1; i <= n; i++) {
      const d = closes[i] - closes[i - 1];
      if (d > 0) g += d; else l -= d;
    }
    g /= n; l /= n;
    out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    for (let i = n + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      g = (g * (n - 1) + Math.max(d, 0)) / n;
      l = (l * (n - 1) + Math.max(-d, 0)) / n;
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return out;
  }

  function atr(c, n = 14) {
    const tr = c.map((k, i) => i === 0 ? k.high - k.low
      : Math.max(k.high - k.low, Math.abs(k.high - c[i - 1].close), Math.abs(k.low - c[i - 1].close)));
    return ema(tr, n);
  }

  // Máximos/mínimos locales: la vela es extremo entre w velas a cada lado
  function pivots(c, w = 3) {
    const highs = [], lows = [];
    for (let i = w; i < c.length - w; i++) {
      let isH = true, isL = true;
      for (let j = i - w; j <= i + w; j++) {
        if (j === i) continue;
        // Empates: se aceptan a la izquierda, no a la derecha (un solo pivote por meseta)
        if (j < i ? c[j].high > c[i].high : c[j].high >= c[i].high) isH = false;
        if (j < i ? c[j].low < c[i].low : c[j].low <= c[i].low) isL = false;
      }
      if (isH) highs.push({ i, price: c[i].high });
      if (isL) lows.push({ i, price: c[i].low });
    }
    return { highs, lows };
  }

  // Agrupa niveles cercanos (dentro de tol relativo) y devuelve zonas ordenadas
  function cluster(prices, tol) {
    const sorted = [...prices].sort((a, b) => a - b);
    const zones = [];
    for (const p of sorted) {
      const z = zones[zones.length - 1];
      if (z && (p - z.avg) / z.avg <= tol) { z.items.push(p); z.avg = z.items.reduce((a, b) => a + b) / z.items.length; }
      else zones.push({ avg: p, items: [p] });
    }
    return zones.map(z => ({ price: z.avg, touches: z.items.length }));
  }

  function pct(a, b) { return b ? (a / b - 1) * 100 : 0; }

  /* analyze(candles, ctx) → estimación.
     ctx (opcional): {buys1h, sells1h, liquidity, mcap, ageH, change24h} */
  function analyze(c, ctx = {}) {
    if (!c || c.length < 20) return null;
    const closes = c.map(k => k.close);
    const last = c[c.length - 1];
    const price = last.close;
    const e9 = ema(closes, 9), e21 = ema(closes, 21);
    const r = rsi(closes, 14);
    const a = atr(c, 14);
    const atrPct = a[a.length - 1] / price * 100;
    const rNow = r[r.length - 1];
    const notes = [], risks = [];
    let score = 0;

    // Tendencia por medias
    const e9n = e9[e9.length - 1], e21n = e21[e21.length - 1];
    const e21prev = e21[Math.max(0, e21.length - 6)];
    if (e9n > e21n) { score += 20; notes.push("Media rápida (EMA9) por encima de la lenta (EMA21): tendencia de corto plazo alcista."); }
    else { score -= 20; notes.push("EMA9 por debajo de EMA21: tendencia de corto plazo bajista."); }
    if (price > e21n) score += 10; else score -= 10;
    const slope = pct(e21n, e21prev);
    if (slope > 0.5) score += 10; else if (slope < -0.5) score -= 10;

    // Estructura: últimos dos máximos y mínimos locales
    const pv = pivots(c, 3);
    const h = pv.highs.slice(-2), l = pv.lows.slice(-2);
    if (h.length === 2 && l.length === 2) {
      const hh = h[1].price > h[0].price, hl = l[1].price > l[0].price;
      if (hh && hl) { score += 20; notes.push("Estructura de máximos y mínimos crecientes."); }
      else if (!hh && !hl) { score -= 20; notes.push("Estructura de máximos y mínimos decrecientes."); }
      else if (!hh && hl) notes.push("Máximos más bajos pero mínimos más altos: el precio se está comprimiendo.");
      else notes.push("Máximo más alto pero mínimo más bajo: volatilidad en expansión, sin dirección clara.");
    }

    // Momentum (RSI)
    if (rNow != null) {
      if (rNow >= 75) { score -= 5; notes.push(`RSI ${rNow.toFixed(0)}: sobrecompra fuerte, riesgo de retroceso.`); }
      else if (rNow >= 55) { score += 10; notes.push(`RSI ${rNow.toFixed(0)}: momentum comprador.`); }
      else if (rNow > 45) notes.push(`RSI ${rNow.toFixed(0)}: momentum neutral.`);
      else if (rNow > 25) { score -= 10; notes.push(`RSI ${rNow.toFixed(0)}: momentum vendedor.`); }
      else { score += 5; notes.push(`RSI ${rNow.toFixed(0)}: sobreventa fuerte, posible rebote técnico.`); }
    }

    // Volumen reciente frente a la media
    const vols = c.map(k => k.volume || 0);
    if (vols.some(v => v > 0)) {
      const avg = vols.slice(-23, -3).reduce((x, y) => x + y, 0) / Math.max(1, vols.slice(-23, -3).length);
      const rec = vols.slice(-3).reduce((x, y) => x + y, 0) / 3;
      const green = c.slice(-3).filter(k => k.close >= k.open).length >= 2;
      if (avg > 0 && rec > 2 * avg) {
        score += green ? 10 : -10;
        notes.push(`Volumen de las últimas velas ×${(rec / avg).toFixed(1)} sobre la media, con velas ${green ? "verdes (compras)" : "rojas (ventas)"}.`);
      } else if (avg > 0 && rec < 0.5 * avg) notes.push("El volumen se está secando: el movimiento pierde fuerza.");
    }

    // Presión compradora (transacciones 1h)
    if (ctx.buys1h != null && ctx.sells1h != null && ctx.buys1h + ctx.sells1h > 20) {
      const ratio = ctx.buys1h / Math.max(1, ctx.sells1h);
      if (ratio > 1.3) { score += 10; notes.push(`Más compras que ventas en 1h (${ctx.buys1h} vs ${ctx.sells1h}).`); }
      else if (ratio < 0.77) { score -= 10; notes.push(`Más ventas que compras en 1h (${ctx.sells1h} vs ${ctx.buys1h}).`); }
    }

    // Niveles: zonas de soporte y resistencia
    const tol = Math.max(0.01, atrPct / 100 * 0.8);
    const sup = cluster(pv.lows.map(p => p.price).filter(p => p < price), tol).sort((x, y) => y.price - x.price);
    const res = cluster(pv.highs.map(p => p.price).filter(p => p > price), tol).sort((x, y) => x.price - y.price);
    const rangeHigh = Math.max(...c.map(k => k.high));
    const rangeLow = Math.min(...c.map(k => k.low));
    const fromHigh = pct(price, rangeHigh);
    if (fromHigh < -50) { score -= 10; notes.push(`Está un ${Math.abs(fromHigh).toFixed(0)}% por debajo del máximo del periodo: tendencia previa rota.`); }
    else if (fromHigh > -3) notes.push("Cotiza cerca del máximo del periodo.");

    // Riesgos de contexto
    if (ctx.ageH != null && ctx.ageH < 24) risks.push(`Token con solo ${ctx.ageH.toFixed(0)} h de vida.`);
    if (ctx.liquidity != null && ctx.liquidity < 25000) risks.push("Liquidez baja: el precio se mueve mucho con poco dinero y salir puede costar caro.");
    if (ctx.liquidity && ctx.mcap && ctx.liquidity / ctx.mcap < 0.05) risks.push("Liquidez muy pequeña frente al market cap.");
    if (ctx.change24h != null && ctx.change24h > 300) risks.push(`Ya subió ${ctx.change24h.toFixed(0)}% en 24h: comprar tarde es el error más común.`);
    if (atrPct > 8) risks.push(`Volatilidad extrema: movimiento típico de ±${atrPct.toFixed(1)}% por vela.`);

    score = Math.max(-100, Math.min(100, Math.round(score)));
    const bias = score >= 30 ? "up" : score <= -30 ? "down" : "flat";
    const s1 = sup[0]?.price, s2 = sup[1]?.price ?? (s1 ? undefined : rangeLow);
    const r1 = res[0]?.price, r2 = res[1]?.price;

    const scenarios = [];
    if (r1) scenarios.push({ dir: "up", text: `Si rompe y cierra por encima de ${fmt(r1)} (${signed(pct(r1, price))}) con volumen, el siguiente objetivo es ${r2 ? fmt(r2) + ` (${signed(pct(r2, price))})` : "el máximo del periodo " + fmt(rangeHigh)}.` });
    else scenarios.push({ dir: "up", text: `Está en máximos del periodo, sin resistencia visible arriba. Si aguanta por encima de ${fmt(e9n)} puede seguir; un rechazo con volumen suele marcar techo.` });
    if (s1) scenarios.push({ dir: "down", text: `Si pierde ${fmt(s1)} (${signed(pct(s1, price))}), la siguiente zona es ${s2 ? fmt(s2) + ` (${signed(pct(s2, price))})` : "el mínimo del periodo " + fmt(rangeLow)}.` });
    else scenarios.push({ dir: "down", text: `Sin soporte claro debajo: el siguiente apoyo es el mínimo del periodo ${fmt(rangeLow)} (${signed(pct(rangeLow, price))}).` });
    scenarios.push({ dir: "flat", text: `Rango probable en las próximas velas: ${fmt(price * (1 - 2 * atrPct / 100))} – ${fmt(price * (1 + 2 * atrPct / 100))} (±${(2 * atrPct).toFixed(1)}%).` });

    const label = bias === "up" ? "Sesgo alcista" : bias === "down" ? "Sesgo bajista" : "Neutral / indeciso";
    const confidence = c.length < 60 || (ctx.liquidity != null && ctx.liquidity < 50000) ? "baja" : Math.abs(score) >= 50 ? "media" : "baja-media";

    return {
      price, score, bias, label, confidence, rsi: rNow, atrPct, ema9: e9n, ema21: e21n,
      supports: sup.slice(0, 2).map(z => z.price), resistances: res.slice(0, 2).map(z => z.price),
      rangeHigh, rangeLow, fromHigh, notes, risks, scenarios, series: { ema9: e9, ema21: e21 },
    };
  }

  function fmt(x) {
    if (x == null || !isFinite(x)) return "?";
    if (x >= 1000) return "$" + x.toLocaleString("en-US", { maximumFractionDigits: 0 });
    if (x >= 1) return "$" + x.toFixed(2);
    if (x >= 0.01) return "$" + x.toFixed(4);
    const d = Math.min(12, Math.ceil(-Math.log10(x)) + 3);
    return "$" + x.toFixed(d).replace(/0+$/, "");
  }
  function signed(p) { return (p >= 0 ? "+" : "") + p.toFixed(1) + "%"; }

  const api = { ema, rsi, atr, pivots, cluster, analyze, fmt, signed };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BVA = api;
})(typeof window !== "undefined" ? window : globalThis);
