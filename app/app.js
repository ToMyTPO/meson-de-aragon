/* BeyondVision: radar de memecoins + top coins con alertas, velas y análisis. */
(function () {
  "use strict";
  const A = window.BVA;
  const API = {
    dex: "https://api.dexscreener.com",
    gt: "https://api.geckoterminal.com/api/v2",
    cg: "https://api.coingecko.com/api/v3",
    claude: "https://api.anthropic.com/v1/messages",
  };
  const GT_NET = { solana: "solana", ethereum: "eth", bsc: "bsc", base: "base" };

  // ------------------------------------------------------------ utilidades
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem("bv:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("bv:" + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
  };
  const num = (x) => { const n = parseFloat(x); return isFinite(n) ? n : null; };
  const usd = (x) => {
    if (x == null) return "?";
    if (x >= 1e9) return "$" + (x / 1e9).toFixed(2) + "B";
    if (x >= 1e6) return "$" + (x / 1e6).toFixed(2) + "M";
    if (x >= 1e3) return "$" + (x / 1e3).toFixed(1) + "K";
    return A.fmt(x);
  };
  const CUR = { USD: "$", EUR: "€", GBP: "£", JPY: "¥" };
  const px = (t, x = t.price) => {
    if (t.kind !== "stk") return A.fmt(x);
    if (x == null) return "?";
    const d = Math.abs(x) >= 1000 ? 0 : Math.abs(x) >= 10 ? 2 : 4;
    const n = x.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d });
    const sym = CUR[t.currency];
    if (/=X$/.test(t.ticker || "") || /^\^/.test(t.ticker || "") || !t.currency) return n; // índices y divisas sin símbolo
    return sym === "$" ? "$" + n : sym ? n + " " + sym : n + " " + t.currency;
  };
  const pctS = (x) => (x == null ? "–" : (x >= 0 ? "+" : "") + x.toFixed(Math.abs(x) >= 100 ? 0 : 1) + "%");
  const cls = (x) => (x == null ? "muted" : x >= 0 ? "up" : "down");
  const ago = (ts) => {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return `hace ${s}s`;
    if (s < 3600) return `hace ${Math.round(s / 60)} min`;
    if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
    return `hace ${Math.round(s / 86400)} d`;
  };
  const age = (h) => (h == null ? "?" : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} d`);
  const safeUrl = (u) => (typeof u === "string" && /^https:\/\//.test(u) ? u : null);

  async function getJSON(url, opts = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeout || 15000);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  function toast(msg, ms = 2500) {
    const el = $("#toast");
    el.textContent = msg; el.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (el.hidden = true), ms);
  }

  // ------------------------------------------------------------ ajustes
  const DEFAULTS = {
    chain: "solana", refreshSec: 10, notify: true, sound: true, cooldownMin: 60,
    up5m: 25, up1h: 60, dn5m: -25, dn1h: -40, volX: 5, vol5mMin: 10000,
    liqMin: 15000, vol1hMin: 10000, ageMinH: 1,
    top1h: 6, top24h: 20, stkIdx: 1.5, stk: 4, earlyMin: 70, apiKey: "",
  };
  let S = Object.assign({}, DEFAULTS, store.get("settings", {}));
  if (!store.get("migr10", false)) { if (S.refreshSec === 30) S.refreshSec = 10; store.set("migr10", true); store.set("settings", S); }
  let watch = store.get("watch", []); // [{chain, address, symbol}]
  let alerts = store.get("alerts", []);
  let cooldown = store.get("cooldown", {});
  let unseen = store.get("unseen", 0);

  // ------------------------------------------------------------ estado
  const state = {
    view: "radar", radar: [], top: [], stocks: [], stocksUpdated: null, stocksErr: null, stkGroup: "Todos", radarFilter: "all", lastOk: 0, lastErr: null,
    flashed: new Set(), alerted: new Set(), detail: null, tf: null, chart: null,
  };

  // ------------------------------------------------------------ datos: memecoins
  function normPair(p) {
    const base = p.baseToken || {}, ch = p.priceChange || {}, vol = p.volume || {};
    const tx = (p.txns || {}).h1 || {}, tx5 = (p.txns || {}).m5 || {};
    const created = p.pairCreatedAt;
    return {
      kind: "dex",
      id: `${p.chainId}:${base.address}`,
      chain: p.chainId, address: base.address, pair: p.pairAddress, dex: p.dexId,
      name: base.name || "?", symbol: base.symbol || "?",
      price: num(p.priceUsd),
      ch: { m5: num(ch.m5), h1: num(ch.h1), h6: num(ch.h6), h24: num(ch.h24) },
      vol5m: num(vol.m5), vol1h: num(vol.h1), vol24h: num(vol.h24),
      liq: num((p.liquidity || {}).usd), mcap: num(p.marketCap) ?? num(p.fdv),
      buys1h: tx.buys ?? null, sells1h: tx.sells ?? null, buys5m: tx5.buys ?? null, sells5m: tx5.sells ?? null,
      ageH: created ? (Date.now() - created) / 3.6e6 : null,
      img: safeUrl((p.info || {}).imageUrl), url: safeUrl(p.url),
      socials: ((p.info || {}).socials || []).concat((p.info || {}).websites || []),
    };
  }

  async function discover(chain) {
    const set = new Set();
    const paths = ["/token-profiles/latest/v1", "/token-boosts/latest/v1", "/token-boosts/top/v1"];
    const res = await Promise.allSettled(paths.map((p) => getJSON(API.dex + p)));
    res.forEach((r) => {
      if (r.status === "fulfilled" && Array.isArray(r.value))
        r.value.forEach((t) => { if (t.chainId === chain && t.tokenAddress) set.add(t.tokenAddress); });
    });
    const net = GT_NET[chain];
    if (net) {
      try {
        const j = await getJSON(`${API.gt}/networks/${net}/trending_pools?page=1`);
        (j.data || []).forEach((p) => {
          const id = p.relationships?.base_token?.data?.id;
          if (id) set.add(id.slice(id.indexOf("_") + 1));
        });
      } catch { /* GeckoTerminal opcional */ }
    }
    if (!set.size && res.every((r) => r.status === "rejected")) throw new Error("DexScreener no responde");
    return [...set];
  }

  async function pairsFor(chain, addresses) {
    const best = new Map();
    for (let i = 0; i < addresses.length; i += 30) {
      const batch = addresses.slice(i, i + 30).join(",");
      try {
        const pairs = await getJSON(`${API.dex}/tokens/v1/${chain}/${batch}`);
        (Array.isArray(pairs) ? pairs : []).forEach((p) => {
          const addr = p.baseToken?.address;
          if (!addr) return;
          const cur = best.get(addr);
          if (!cur || (num(p.liquidity?.usd) || 0) > (num(cur.liquidity?.usd) || 0)) best.set(addr, p);
        });
      } catch (e) { console.warn(e); }
    }
    return [...best.values()].map(normPair);
  }

  const isWatched = (t) => watch.some((w) => w.chain === t.chain && w.address === t.address);
  const passFilters = (t) => isWatched(t) || (
    (t.liq || 0) >= S.liqMin && (t.vol1h || 0) >= S.vol1hMin && (t.ageH == null || t.ageH >= S.ageMinH));

  // Descubrir tokens cuesta más peticiones y cambia despacio: cada 60 s. Los precios, en cada ciclo.
  let disc = { chain: null, addrs: [], ts: 0 };
  async function refreshRadar() {
    const chain = S.chain;
    if (disc.chain !== chain || Date.now() - disc.ts > 60000 || !disc.addrs.length) {
      disc = { chain, addrs: await discover(chain), ts: Date.now() };
    }
    const addrs = disc.addrs.slice();
    watch.filter((w) => w.chain === chain).forEach((w) => { if (!addrs.includes(w.address)) addrs.push(w.address); });
    let tokens = await pairsFor(chain, addrs);
    // Tokens de mi lista en otras redes
    const others = {};
    watch.filter((w) => w.chain !== chain).forEach((w) => (others[w.chain] ||= []).push(w.address));
    for (const [c, list] of Object.entries(others)) tokens = tokens.concat(await pairsFor(c, list));
    tokens = tokens.filter(passFilters);
    tokens.forEach((t) => (t.flags = evaluateDex(t)));
    state.radar = tokens;
    tokens.forEach((t) => t.flags.length && fireAlerts(t, t.flags));
  }

  // ------------------------------------------------------------ datos: top coins
  async function refreshTop() {
    const url = `${API.cg}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=true&price_change_percentage=1h,24h,7d`;
    const data = await getJSON(url);
    state.top = data.map((c) => {
      const t = {
        kind: "cg", id: "cg:" + c.id, cgId: c.id, name: c.name, symbol: (c.symbol || "").toUpperCase(),
        price: num(c.current_price), mcap: num(c.market_cap), rank: c.market_cap_rank, vol24h: num(c.total_volume),
        ch: { h1: num(c.price_change_percentage_1h_in_currency), h24: num(c.price_change_percentage_24h_in_currency), d7: num(c.price_change_percentage_7d_in_currency) },
        img: safeUrl(c.image), spark: c.sparkline_in_7d?.price || [],
        url: `https://www.coingecko.com/es/monedas/${encodeURIComponent(c.id)}`,
        high24: num(c.high_24h), low24: num(c.low_24h), ath: num(c.ath), athPct: num(c.ath_change_percentage),
      };
      t.flags = evaluateTop(t);
      return t;
    });
    state.top.forEach((t) => t.flags.length && fireAlerts(t, t.flags));
  }

  // ------------------------------------------------------------ datos: bolsa
  async function refreshStocks() {
    const j = await getJSON("data/bolsa.json?t=" + Math.floor(Date.now() / 60000));
    state.stocksUpdated = j.updated * 1000;
    state.stocks = (j.items || []).map((x) => {
      const named = x.group === "Índices" || x.group === "Materias y divisas";
      const t = {
        kind: "stk", id: "stk:" + x.symbol, ticker: x.symbol, file: x.file, group: x.group,
        symbol: named ? x.name : x.symbol, name: named ? x.symbol : x.name,
        price: x.price, currency: x.currency, exchange: x.exchange, time: x.time ? x.time * 1000 : null,
        ch: { d1: x.ch["1d"], d5: x.ch["5d"], m1: x.ch["1m"], y1: x.ch["1y"] },
        high52: x.high52, low52: x.low52, dayHigh: x.dayHigh, dayLow: x.dayLow, volume: x.volume,
        url: "https://www.tradingview.com/symbols/" + encodeURIComponent(x.symbol) + "/", mcap: null,
      };
      t.signal = x.signal || null;
      t.flags = evaluateStk(t);
      return t;
    });
    state.stocksErr = null;
    state.stocks.forEach((t) => t.flags.length && fireAlerts(t, t.flags));
  }

  // ------------------------------------------------------------ reglas
  // Señal temprana: patrones que suelen preceder a una subida fuerte (no la predicen)
  function earlyScore(t) {
    if ((t.liq || 0) < 15000) return [0, []];
    let p = 0; const why = [];
    const avg = t.vol1h ? t.vol1h / 12 : 0;
    if (avg > 0 && t.vol5m) {
      const acc = t.vol5m / avg;
      if (acc >= 3) { p += 35; why.push(`volumen 5m ×${acc.toFixed(1)}`); }
      else if (acc >= 2) { p += 25; why.push(`volumen 5m ×${acc.toFixed(1)}`); }
    }
    if (t.buys5m != null && t.sells5m != null && t.buys5m + t.sells5m >= 20) {
      const r = t.buys5m / Math.max(t.sells5m, 1);
      if (r >= 2.5) { p += 25; why.push(`compras/ventas 5m ${t.buys5m}/${t.sells5m}`); }
      else if (r >= 1.5) { p += 20; why.push(`compras/ventas 5m ${t.buys5m}/${t.sells5m}`); }
      if (t.buys5m + t.sells5m >= 60) p += 10;
    }
    if (t.ch.m5 != null && t.ch.m5 >= 3 && t.ch.m5 <= 25) { p += 15; why.push(`arrancando ${pctS(t.ch.m5)} en 5m`); }
    if (t.ch.h1 != null && t.ch.h1 >= 0 && t.ch.h1 <= 60) p += 10;
    if ((t.liq || 0) >= 30000) p += 10;
    if (t.ageH != null && t.ageH >= 1 && t.ageH <= 72) p += 5;
    let pen = 0;
    if (t.ch.h24 != null && t.ch.h24 > 300) { pen = 40; why.push(`ya subió ${t.ch.h24.toFixed(0)}% en 24h`); }
    else if (t.ch.h24 != null && t.ch.h24 > 100) pen = 15;
    return [Math.max(0, Math.min(100, p) - pen), why];
  }

  function evaluateDex(t) {
    const f = [];
    const [sc, why] = earlyScore(t);
    t.early = sc;
    if (sc >= (isWatched(t) ? S.earlyMin - 10 : S.earlyMin)) f.push(["senal", "senal", `señal ${sc}/100: ${why.join(", ")}`]);
    const w = isWatched(t), k = w ? 0.5 : 1; // mi lista: avisa con la mitad del movimiento
    if (t.ch.m5 != null && t.ch.m5 >= S.up5m * k) f.push(["subida_5m", "subida", `+${t.ch.m5.toFixed(1)}% en 5 min`]);
    if (t.ch.h1 != null && t.ch.h1 >= S.up1h * k) f.push(["subida_1h", "subida", `+${t.ch.h1.toFixed(1)}% en 1 h`]);
    if (t.ch.m5 != null && t.ch.m5 <= S.dn5m * k) f.push(["bajada_5m", "bajada", `${t.ch.m5.toFixed(1)}% en 5 min`]);
    if (t.ch.h1 != null && t.ch.h1 <= S.dn1h * k) f.push(["bajada_1h", "bajada", `${t.ch.h1.toFixed(1)}% en 1 h`]);
    if (t.vol5m && t.vol1h) {
      const avg = t.vol1h / 12;
      if (avg > 0 && t.vol5m >= S.volX * avg && t.vol5m >= S.vol5mMin * k)
        f.push(["volumen", "volumen", `volumen 5 min ×${(t.vol5m / avg).toFixed(1)}`]);
    }
    return f;
  }

  function evaluateTop(t) {
    const f = [];
    if (t.ch.h1 != null && Math.abs(t.ch.h1) >= S.top1h)
      f.push([t.ch.h1 > 0 ? "subida_1h" : "bajada_1h", t.ch.h1 > 0 ? "subida" : "bajada", `${pctS(t.ch.h1)} en 1 h`]);
    if (t.ch.h24 != null && Math.abs(t.ch.h24) >= S.top24h)
      f.push([t.ch.h24 > 0 ? "subida_24h" : "bajada_24h", t.ch.h24 > 0 ? "subida" : "bajada", `${pctS(t.ch.h24)} en 24 h`]);
    return f;
  }

  function evaluateStk(t) {
    const out = [];
    if (t.signal && t.signal.score >= S.earlyMin) {
      const day = new Date(t.time || Date.now()).toISOString().slice(0, 10);
      out.push([`d1_${day}_senal`, "senal", `señal ${t.signal.score}/100: ${t.signal.reasons.join(", ")}`]);
    }
    const th = t.group === "Índices" || t.group === "Materias y divisas" ? S.stkIdx : S.stk;
    const v = t.ch.d1;
    if (v == null || Math.abs(v) < th) return out;
    // Un aviso por día y por escalón (p. ej. -4%, luego -8%)
    const day = new Date(t.time || Date.now()).toISOString().slice(0, 10);
    const step = Math.floor(Math.abs(v) / th);
    out.push([`d1_${day}_${v > 0 ? "up" : "dn"}${step}`, v > 0 ? "subida" : "bajada", `${pctS(v)} hoy`]);
    return out;
  }

  function riskTags(t) {
    const r = [];
    if (t.kind !== "dex") return r;
    if (t.ageH != null && t.ageH < 24) r.push("nuevo");
    if (t.liq != null && t.liq < 25000) r.push("liq. baja");
    if (t.buys1h != null && t.sells1h != null && t.sells1h > 2 * Math.max(t.buys1h, 1)) r.push("ventas");
    if (t.ch.h1 != null && t.ch.h1 >= 100 && ((t.liq && t.mcap && t.liq / t.mcap < 0.03) || (t.buys5m != null && t.sells5m > 1.5 * Math.max(t.buys5m, 1)))) r.push("posible inflado");
    return r;
  }

  // ------------------------------------------------------------ alertas
  let audioCtx = null;
  function beep(type) {
    if (!S.sound) return;
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      const notes = type === "senal" ? [600, 800, 1000] : type === "bajada" ? [660, 440] : type === "subida" ? [520, 880] : [700, 700];
      notes.forEach((f, i) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = f; o.type = "sine";
        g.gain.setValueAtTime(0.0001, audioCtx.currentTime + i * 0.16);
        g.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + i * 0.16 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + i * 0.16 + 0.15);
        o.connect(g).connect(audioCtx.destination);
        o.start(audioCtx.currentTime + i * 0.16); o.stop(audioCtx.currentTime + i * 0.16 + 0.16);
      });
    } catch { /* audio no disponible */ }
  }

  async function notify(title, body, tag) {
    if (!S.notify || !("Notification" in window) || Notification.permission !== "granted") return;
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) reg.showNotification(title, { body, tag, icon: "icon-192.png", badge: "icon-192.png", data: { tag } });
      else new Notification(title, { body, tag });
    } catch { /* notificaciones no disponibles */ }
  }

  function fireAlerts(t, flags) {
    const now = Date.now();
    const fresh = flags.filter(([key]) => {
      const k = `${t.id}|${key}`;
      const cd = key.startsWith("d1_") ? 1440 : S.cooldownMin;
      return !cooldown[k] || now - cooldown[k] >= cd * 60000;
    });
    if (!fresh.length) return;
    fresh.forEach(([key]) => (cooldown[`${t.id}|${key}`] = now));
    const type = fresh[0][1];
    const reason = fresh.map((f) => f[2]).join(" · ");
    const a = {
      ts: now, id: t.id, kind: t.kind, chain: t.chain, address: t.address, cgId: t.cgId, currency: t.currency, ticker: t.ticker,
      name: t.name, symbol: t.symbol, type, reason, price: t.price, mcap: t.mcap, risks: riskTags(t),
    };
    alerts.unshift(a);
    alerts = alerts.slice(0, 200);
    state.flashed.add(t.id);
    if (state.view !== "alerts") unseen++;
    const icon = type === "senal" ? "⚡" : type === "subida" ? "🚀" : type === "bajada" ? "🔻" : "📈";
    const title = type === "senal" ? `⚡ Señal temprana en ${t.symbol}` : `${icon} ${t.symbol} ${type === "subida" ? "sube" : type === "bajada" ? "cae" : "volumen"}: ${reason}`;
    const body = `${type === "senal" ? reason + " · " : ""}${t.name} · ${px(t)}${t.mcap ? " · MC " + usd(t.mcap) : ""}${a.risks.length ? " · ⚠️ " + a.risks.join(", ") : ""}`;
    notify(title, body, t.id);
    beep(type);
    persistAlerts();
  }

  function persistAlerts() {
    // limpiar enfriamientos de más de 2 días
    const lim = Date.now() - 2 * 864e5;
    Object.keys(cooldown).forEach((k) => cooldown[k] < lim && delete cooldown[k]);
    store.set("alerts", alerts); store.set("cooldown", cooldown); store.set("unseen", unseen);
  }

  // ------------------------------------------------------------ render: listas
  function avatar(t) {
    return `<span class="av">${t.img ? `<img src="${esc(t.img)}" alt="" loading="lazy" onerror="this.remove()">` : ""}${t.img ? "" : esc(t.symbol.slice(0, 3))}</span>`;
  }

  function tokenRow(t) {
    const tags = [];
    t.flags.forEach(([, type]) => {
      if (type === "subida" && !tags.includes("up")) tags.push("up");
      if (type === "bajada" && !tags.includes("down")) tags.push("down");
      if (type === "volumen" && !tags.includes("vol")) tags.push("vol");
      if (type === "senal" && !tags.includes("early")) tags.unshift("early");
    });
    const stk = t.kind === "stk";
    const tagHtml = tags.map((x) => `<span class="tag ${x}">${x === "early" ? "⚡ señal" : x === "up" ? (stk ? "sube" : "pump") : x === "down" ? (stk ? "cae" : "dump") : "vol"}</span>`).join("")
      + riskTags(t).map((r) => `<span class="tag risk">${esc(r)}</span>`).join("");
    const pressure = t.buys1h != null && t.sells1h != null && t.buys1h + t.sells1h > 0
      ? `<div class="pbar"><i style="width:${(100 * t.buys1h / (t.buys1h + t.sells1h)).toFixed(0)}%"></i></div>` : "";
    const sub = t.kind === "dex"
      ? `MC ${usd(t.mcap)} · Liq ${usd(t.liq)} · Vol 1h ${usd(t.vol1h)} · ${age(t.ageH)}`
      : stk ? `${esc(t.exchange || t.group)}`
      : `#${t.rank} · MC ${usd(t.mcap)} · Vol 24h ${usd(t.vol24h)}`;
    const chg = stk
      ? `<span class="${cls(t.ch.d1)}"><em>hoy</em>${pctS(t.ch.d1)}</span><span class="${cls(t.ch.d5)}"><em>5d</em>${pctS(t.ch.d5)}</span><span class="${cls(t.ch.m1)}"><em>1m</em>${pctS(t.ch.m1)}</span>`
      : t.kind === "dex"
      ? `<span class="${cls(t.ch.m5)}"><em>5m</em>${pctS(t.ch.m5)}</span><span class="${cls(t.ch.h1)}"><em>1h</em>${pctS(t.ch.h1)}</span><span class="${cls(t.ch.h24)}"><em>24h</em>${pctS(t.ch.h24)}</span>`
      : `<span class="${cls(t.ch.h1)}"><em>1h</em>${pctS(t.ch.h1)}</span><span class="${cls(t.ch.h24)}"><em>24h</em>${pctS(t.ch.h24)}</span><span class="${cls(t.ch.d7)}"><em>7d</em>${pctS(t.ch.d7)}</span>`;
    const flash = state.flashed.has(t.id) ? " flash" : "";
    return `<button class="row-t${flash}" data-id="${esc(t.id)}">
      ${avatar(t)}
      <span class="name"><b>${isWatched(t) ? "★ " : ""}<span class="sym">${esc(t.symbol)}</span>${tagHtml}</b><small>${esc(t.name)} · ${sub}</small>${pressure}</span>
      <span class="right"><span class="p">${px(t)}</span><span class="changes">${chg}</span></span>
    </button>`;
  }

  function renderRadar() {
    let list = state.radar.slice();
    const f = state.radarFilter;
    if (f === "up") list = list.filter((t) => (t.ch.h1 ?? 0) > 0);
    if (f === "down") list = list.filter((t) => (t.ch.h1 ?? 0) < 0);
    if (f === "alert") list = list.filter((t) => t.flags.length);
    if (f === "early") list = list.filter((t) => (t.early || 0) >= S.earlyMin - 20).sort((a, b) => b.early - a.early);
    if (f === "watch") list = list.filter(isWatched);
    const sort = $("#sort").value;
    const key = { early: (t) => t.early, m5: (t) => t.ch.m5, h1: (t) => t.ch.h1, h24: (t) => t.ch.h24, vol: (t) => t.vol1h, drop: (t) => -(t.ch.h1 ?? 0), new: (t) => -(t.ageH ?? 1e9) }[sort];
    list.sort((a, b) => (key(b) ?? -1e12) - (key(a) ?? -1e12));
    $("#radarList").innerHTML = list.length ? list.slice(0, 120).map(tokenRow).join("")
      : `<div class="empty">${state.lastErr ? "No hay datos: " + esc(state.lastErr) : f === "watch" ? "Tu lista está vacía. Abre un token y pulsa ★, o pega un contrato abajo." : "Ningún token cumple los filtros ahora mismo."}</div>`;
  }

  function renderTop() {
    let list = state.top.slice();
    const q = $("#topSearch").value.trim().toLowerCase();
    if (q) list = list.filter((t) => t.name.toLowerCase().includes(q) || t.symbol.toLowerCase().includes(q));
    const sort = $("#topSort").value;
    const key = { rank: (t) => -t.rank, h1: (t) => t.ch.h1, h24: (t) => t.ch.h24, drop: (t) => -(t.ch.h24 ?? 0) }[sort];
    list.sort((a, b) => (key(b) ?? -1e12) - (key(a) ?? -1e12));
    $("#topList").innerHTML = list.length ? list.map(tokenRow).join("") : `<div class="empty">Sin datos de CoinGecko todavía.</div>`;
  }

  function renderStocks() {
    const STK_GROUPS = ["Todos", ...new Set(state.stocks.map((t) => t.group))];
    $("#stkGroups").innerHTML = STK_GROUPS.map((g) => `<button class="chip${g === state.stkGroup ? " on" : ""}" data-g="${esc(g)}">${esc(g)}</button>`).join("");
    let list = state.stocks.slice();
    if (state.stkGroup !== "Todos") list = list.filter((t) => t.group === state.stkGroup);
    const q = $("#stkSearch").value.trim().toLowerCase();
    if (q) list = list.filter((t) => (t.name + " " + t.symbol + " " + t.ticker).toLowerCase().includes(q));
    const sort = $("#stkSort").value;
    const key = { d1: (t) => t.ch.d1, drop: (t) => -(t.ch.d1 ?? 0), d5: (t) => t.ch.d5, m1: (t) => t.ch.m1 }[sort];
    if (key) list.sort((a, b) => (key(b) ?? -1e12) - (key(a) ?? -1e12));
    $("#stkUpdated").textContent = state.stocksUpdated
      ? `Datos de Twelve Data, actualizados ${ago(state.stocksUpdated)}. Se renuevan cada 30 min en horario de EE. UU.` : "";
    $("#stkList").innerHTML = list.length ? list.map(tokenRow).join("")
      : `<div class="empty">${state.stocksErr ? "Aún no hay datos de bolsa. Se activan al guardar la clave TWELVEDATA_API_KEY en GitHub y llegan en la siguiente actualización." : "Cargando bolsa…"}</div>`;
  }

  function renderAlerts() {
    $("#alertList").innerHTML = alerts.length ? alerts.map((a, i) => `
      <button class="alert ${esc(a.type)}" data-alert="${i}">
        <span class="stripe"></span>
        <span><b>${esc(a.symbol)}</b> <span class="muted">${esc(a.name)}</span>
          <div class="why ${a.type === "subida" ? "up" : a.type === "bajada" ? "down" : ""}">${esc(a.reason)}</div>
          <div class="meta">${ago(a.ts)} · ${px({ kind: a.kind, currency: a.currency, ticker: a.ticker || "" }, a.price)}${a.mcap ? " · MC " + usd(a.mcap) : ""}${a.chain ? " · " + esc(a.chain) : ""}${a.risks?.length ? " · ⚠️ " + esc(a.risks.join(", ")) : ""}</div>
        </span>
      </button>`).join("")
      : `<div class="empty">Aún no hay alertas. Cuando un token pase tus umbrales aparecerá aquí y sonará un aviso.</div>`;
    const showBanner = "Notification" in window && Notification.permission !== "granted";
    $("#notifBanner").hidden = !showBanner;
  }

  function renderBadge() {
    const b = $("#alertBadge");
    b.hidden = !unseen; b.textContent = unseen > 99 ? "99+" : unseen;
  }

  function renderLive() {
    const el = $("#live");
    el.classList.toggle("ok", !state.lastErr && !!state.lastOk);
    el.classList.toggle("err", !!state.lastErr);
    $("#liveText").textContent = state.lastErr ? "sin conexión" : state.lastOk ? `en vivo · ${ago(state.lastOk)}` : "conectando…";
  }

  function renderAll() {
    if (state.view === "radar") renderRadar();
    if (state.view === "top") renderTop();
    if (state.view === "stocks") renderStocks();
    if (state.view === "alerts") renderAlerts();
    renderBadge(); renderLive();
    state.flashed.clear();
  }

  // ------------------------------------------------------------ bucle principal
  let cycle = 0, timer = null, busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      await refreshRadar();
      const every = (sec) => cycle % Math.max(1, Math.round(sec / Math.max(5, S.refreshSec))) === 0;
      if (every(60)) await refreshTop().catch((e) => console.warn("CoinGecko", e));
      if (every(60)) await refreshStocks().catch((e) => { state.stocksErr = e.message; });
      state.lastOk = Date.now(); state.lastErr = null;
    } catch (e) {
      state.lastErr = e.message || String(e);
    } finally {
      busy = false; cycle++;
      renderAll();
      if (state.detail) refreshDetailHeader();
    }
  }
  function schedule() {
    clearInterval(timer);
    timer = setInterval(tick, Math.max(5, S.refreshSec) * 1000);
  }
  setInterval(renderLive, 5000);

  // ------------------------------------------------------------ detalle
  const TF_DEX = [["1m", "minute", 1], ["5m", "minute", 5], ["15m", "minute", 15], ["1h", "hour", 1], ["4h", "hour", 4], ["1D", "day", 1]];
  const TF_CG = [["30m", 1], ["4h", 14], ["4D", 180]];
  const TF_STK = ["15m", "1h", "1D"];

  function findToken(id) {
    return state.radar.find((t) => t.id === id) || state.top.find((t) => t.id === id) || state.stocks.find((t) => t.id === id) || (state.detail?.id === id ? state.detail : null);
  }

  async function openDetail(t) {
    state.detail = t;
    state.tf = t.kind === "dex" ? "5m" : t.kind === "stk" ? "1D" : "30m";
    $("#sheet").hidden = false;
    document.body.style.overflow = "hidden";
    $("#aiOut").hidden = true; $("#aiOut").textContent = "";
    refreshDetailHeader();
    renderTfs();
    loadCandles();
  }

  function closeDetail() {
    $("#sheet").hidden = true;
    document.body.style.overflow = "";
    state.detail = null;
    if (state.chart) { state.chart.remove(); state.chart = null; }
    state.series = null;
  }

  function refreshDetailHeader() {
    const live = findToken(state.detail.id);
    if (live) state.detail = live;
    const t = state.detail;
    $("#dTitle").innerHTML = `<b>${esc(t.symbol)}</b><small>${esc(t.name)}${t.chain ? " · " + esc(t.chain) : t.rank ? " · #" + t.rank : t.exchange ? " · " + esc(t.exchange) : ""}</small>`;
    $("#dStar").classList.toggle("on", t.kind === "dex" && isWatched(t));
    $("#dStar").hidden = t.kind !== "dex";
    const ch = t.kind === "dex"
      ? [["5m", t.ch.m5], ["1h", t.ch.h1], ["6h", t.ch.h6], ["24h", t.ch.h24]]
      : t.kind === "stk" ? [["hoy", t.ch.d1], ["5d", t.ch.d5], ["1m", t.ch.m1], ["1a", t.ch.y1]]
      : [["1h", t.ch.h1], ["24h", t.ch.h24], ["7d", t.ch.d7]];
    $("#dPrice").innerHTML = `<div class="big">${px(t)}</div><div class="changes">${ch.map(([k, v]) => `<span class="${cls(v)}"><em>${k}</em> ${pctS(v)}</span>`).join("")}</div>`;
    const stats = t.kind === "stk"
      ? [["Máx hoy", px(t, t.dayHigh)], ["Mín hoy", px(t, t.dayLow)], ["Volumen", t.volume ? t.volume.toLocaleString("es-ES") : "–"], ["Máx 52 sem", px(t, t.high52)], ["Mín 52 sem", px(t, t.low52)], ["Cotización", t.time ? ago(t.time) : "?"]]
      : t.kind === "dex"
      ? [["Market cap", usd(t.mcap)], ["Liquidez", usd(t.liq)], ["Vol 1h", usd(t.vol1h)], ["Vol 24h", usd(t.vol24h)], ["Compras/ventas 1h", `${t.buys1h ?? "?"}/${t.sells1h ?? "?"}`], ["Edad", age(t.ageH)]]
      : [["Market cap", usd(t.mcap)], ["Ranking", "#" + t.rank], ["Vol 24h", usd(t.vol24h)], ["Máx 24h", A.fmt(t.high24)], ["Mín 24h", A.fmt(t.low24)], ["Desde ATH", pctS(t.athPct)]];
    $("#dStats").innerHTML = stats.map(([k, v]) => `<div><small>${k}</small><span>${esc(v)}</span></div>`).join("");
    const links = [];
    if (t.url) links.push(`<a href="${esc(t.url)}" target="_blank" rel="noopener">${t.kind === "dex" ? "DexScreener" : t.kind === "stk" ? "TradingView" : "CoinGecko"}</a>`);
    if (t.kind === "dex" && t.chain === "solana") links.push(`<a href="https://rugcheck.xyz/tokens/${encodeURIComponent(t.address)}" target="_blank" rel="noopener">RugCheck</a>`);
    if (t.kind === "dex") links.push(`<button id="copyAddr">Copiar contrato</button>`);
    $("#dLinks").innerHTML = links.join("");
    const ca = $("#copyAddr");
    if (ca) ca.onclick = () => copy(t.address, "Contrato copiado");
  }

  function renderTfs() {
    const t = state.detail;
    const tfs = t.kind === "dex" ? TF_DEX.map((x) => x[0]) : t.kind === "stk" ? TF_STK : TF_CG.map((x) => x[0]);
    $("#tfs").innerHTML = tfs.map((x) => `<button data-tf="${x}" class="${x === state.tf ? "on" : ""}">${x}</button>`).join("");
  }

  async function fetchCandles(t, tf) {
    if (t.kind === "dex") {
      const net = GT_NET[t.chain];
      if (!net) throw new Error("Velas no disponibles para esta red");
      const [, unit, agg] = TF_DEX.find((x) => x[0] === tf);
      const j = await getJSON(`${API.gt}/networks/${net}/pools/${t.pair}/ohlcv/${unit}?aggregate=${agg}&limit=300&currency=usd`);
      const list = j?.data?.attributes?.ohlcv_list || [];
      return list.map((k) => ({ time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] })).sort((a, b) => a.time - b.time);
    }
    if (t.kind === "stk") {
      const j = await getJSON(`data/velas/${encodeURIComponent(t.file)}.json?t=${Math.floor(Date.now() / 60000)}`);
      let list = (tf === "1D" ? j["1D"] : j["15m"]) || [];
      list = list.map((k) => ({ time: k[0], open: k[1], high: k[2], low: k[3], close: k[4], volume: k[5] }));
      if (tf === "1h") { // agrupar velas de 15 min en horas
        const m = new Map();
        list.forEach((k) => {
          const h = Math.floor(k.time / 3600) * 3600, c = m.get(h);
          if (!c) m.set(h, { ...k, time: h });
          else { c.high = Math.max(c.high, k.high); c.low = Math.min(c.low, k.low); c.close = k.close; c.volume += k.volume; }
        });
        list = [...m.values()];
      }
      return list.sort((a, b) => a.time - b.time);
    }
    const [, days] = TF_CG.find((x) => x[0] === tf);
    const list = await getJSON(`${API.cg}/coins/${encodeURIComponent(t.cgId)}/ohlc?vs_currency=usd&days=${days}`);
    const seen = new Set();
    return list.map((k) => ({ time: Math.floor(k[0] / 1000), open: k[1], high: k[2], low: k[3], close: k[4], volume: 0 }))
      .filter((k) => !seen.has(k.time) && seen.add(k.time)).sort((a, b) => a.time - b.time);
  }

  async function loadCandles() {
    const t = state.detail, tf = state.tf;
    const box = $("#chart");
    box.innerHTML = `<div class="empty">Cargando velas…</div>`;
    $("#reading").innerHTML = "";
    let candles;
    try { candles = await fetchCandles(t, tf); }
    catch (e) { box.innerHTML = `<div class="empty">No se pudieron cargar las velas (${esc(e.message)}).${t.url ? ` <a href="${esc(t.url)}" target="_blank" rel="noopener">Ver gráfico externo</a>` : ""}</div>`; return; }
    if (state.detail !== t || state.tf !== tf) return;
    if (!candles.length) { box.innerHTML = `<div class="empty">Sin velas para este periodo.</div>`; return; }
    state.candles = candles;
    const res = A.analyze(candles, { buys1h: t.buys1h, sells1h: t.sells1h, liquidity: t.liq, mcap: t.mcap, ageH: t.ageH, change24h: t.ch.h24 });
    state.reading = res;
    drawChart(candles, res);
    renderReading(res, tf);
  }

  function drawChart(candles, res) {
    const box = $("#chart");
    box.innerHTML = "";
    if (state.chart) { state.chart.remove(); state.chart = null; }
    if (!window.LightweightCharts) { box.innerHTML = `<div class="empty">No se pudo cargar la librería de gráficos.</div>`; return; }
    const css = getComputedStyle(document.documentElement);
    const c = (n) => css.getPropertyValue(n).trim();
    const chart = LightweightCharts.createChart(box, {
      autoSize: true,
      layout: { background: { color: c("--panel") }, textColor: c("--muted"), fontFamily: "JetBrains Mono, monospace", fontSize: 11 },
      grid: { vertLines: { color: c("--line") }, horzLines: { color: c("--line") } },
      rightPriceScale: { borderColor: c("--line") },
      timeScale: { borderColor: c("--line"), timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    });
    const prec = candles[candles.length - 1].close;
    const decimals = prec >= 1 ? 2 : Math.min(10, Math.ceil(-Math.log10(prec)) + 3);
    const priceFormat = { type: "price", precision: decimals, minMove: Math.pow(10, -decimals) };
    const cs = chart.addCandlestickSeries({ upColor: c("--up"), downColor: c("--down"), borderVisible: false, wickUpColor: c("--up"), wickDownColor: c("--down"), priceFormat });
    cs.setData(candles);
    state.series = { cs, vs: null, lines: [] };
    if (candles.some((k) => k.volume > 0)) {
      const vs = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol" });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      vs.setData(candles.map((k) => ({ time: k.time, value: k.volume, color: (k.close >= k.open ? c("--up") : c("--down")) + "66" })));
      state.series.vs = vs;
    }
    if (res) {
      const line = (vals, color) => {
        const s = chart.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat });
        s.setData(candles.map((k, i) => ({ time: k.time, value: vals[i] })));
        state.series.lines.push(s);
      };
      line(res.series.ema9, c("--accent"));
      line(res.series.ema21, c("--warn"));
      res.supports.forEach((p, i) => cs.createPriceLine({ price: p, color: c("--up"), lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "S" + (i + 1) }));
      res.resistances.forEach((p, i) => cs.createPriceLine({ price: p, color: c("--down"), lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "R" + (i + 1) }));
    }
    chart.timeScale().fitContent();
    state.chart = chart;
  }

  // Actualiza velas e indicadores del token abierto sin redibujar el gráfico
  async function liveCandles() {
    const t = state.detail, tf = state.tf;
    if (!t || !state.chart || !state.series || document.hidden || busyLive) return;
    busyLive = true;
    try {
      const candles = await fetchCandles(t, tf);
      if (state.detail !== t || state.tf !== tf || !candles.length || !state.series) return;
      const css = getComputedStyle(document.documentElement), c = (n) => css.getPropertyValue(n).trim();
      state.candles = candles;
      state.series.cs.setData(candles);
      if (state.series.vs) state.series.vs.setData(candles.map((k) => ({ time: k.time, value: k.volume, color: (k.close >= k.open ? c("--up") : c("--down")) + "66" })));
      const res = A.analyze(candles, { buys1h: t.buys1h, sells1h: t.sells1h, liquidity: t.liq, mcap: t.mcap, ageH: t.ageH, change24h: t.ch.h24 });
      if (res) {
        state.reading = res;
        [res.series.ema9, res.series.ema21].forEach((vals, i) => state.series.lines[i]?.setData(candles.map((k, j) => ({ time: k.time, value: vals[j] }))));
        renderReading(res, tf);
      }
    } catch (e) { console.warn("velas en vivo", e); }
    finally { busyLive = false; }
  }
  let busyLive = false;
  setInterval(() => { if (state.detail && state.detail.kind !== "stk") liveCandles(); }, 15000);

  function renderReading(r, tf) {
    if (!r) { $("#reading").innerHTML = `<p class="muted">Pocas velas para estimar (mínimo 20). Prueba otra temporalidad.</p>`; return; }
    const pos = (r.score + 100) / 2;
    $("#reading").innerHTML = `
      <h3>Lectura técnica · ${esc(tf)} <span class="bias ${r.bias}">${r.label}</span></h3>
      <div class="gauge" title="Puntuación ${r.score}"><i style="left:${pos}%"></i></div>
      <div class="levels">
        <div><small>Resistencias</small><span class="num down">${r.resistances.map(A.fmt).join(" · ") || "en máximos"}</span></div>
        <div><small>Soportes</small><span class="num up">${r.supports.map(A.fmt).join(" · ") || "sin soporte claro"}</span></div>
        <div><small>RSI 14</small><span class="num">${r.rsi != null ? r.rsi.toFixed(0) : "?"}</span></div>
        <div><small>Volatilidad por vela</small><span class="num">±${r.atrPct.toFixed(1)}%</span></div>
      </div>
      <ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
      <div class="scen">${r.scenarios.map((s) => `<p class="${s.dir}">${esc(s.text)}</p>`).join("")}</div>
      ${r.risks.length ? `<ul class="risks">${r.risks.map((x) => `<li>⚠️ ${esc(x)}</li>`).join("")}</ul>` : ""}
      <p class="muted small">Confianza: ${r.confidence}. Puntuación ${r.score > 0 ? "+" : ""}${r.score} sobre ±100.</p>`;
  }

  // ------------------------------------------------------------ análisis IA
  function buildPrompt() {
    const t = state.detail, r = state.reading, c = state.candles || [];
    const lastC = c.slice(-60).map((k) => [new Date(k.time * 1000).toISOString().slice(5, 16), +k.open.toPrecision(5), +k.high.toPrecision(5), +k.low.toPrecision(5), +k.close.toPrecision(5), Math.round(k.volume)]);
    const data = {
      activo: { tipo: t.kind === "stk" ? "bolsa (" + t.group + ")" : t.kind === "dex" ? "memecoin / token DEX" : "criptomoneda", nombre: t.name, simbolo: t.symbol, ticker: t.ticker || null, mercado: t.exchange || null, divisa: t.currency || "USD", red: t.chain || null, contrato: t.address || null, ranking: t.rank || null },
      max_min_52_semanas: t.kind === "stk" ? [t.high52, t.low52] : undefined,
      precio_usd: t.price, cambios_pct: t.ch, market_cap: t.mcap, liquidez_usd: t.liq ?? null,
      volumen: { "5m": t.vol5m ?? null, "1h": t.vol1h ?? null, "24h": t.vol24h ?? null },
      transacciones_1h: t.buys1h != null ? { compras: t.buys1h, ventas: t.sells1h } : null,
      edad_horas: t.ageH != null ? Math.round(t.ageH) : null,
      temporalidad: state.tf,
      indicadores: r ? { rsi14: r.rsi && +r.rsi.toFixed(1), ema9: r.ema9, ema21: r.ema21, volatilidad_vela_pct: +r.atrPct.toFixed(2), soportes: r.supports, resistencias: r.resistances, max_periodo: r.rangeHigh, min_periodo: r.rangeLow, puntuacion_auto: r.score } : null,
      ultimas_velas_fecha_o_h_l_c_vol: lastC,
    };
    return `Eres un analista de mercados (criptomonedas y bolsa). Analiza este activo con los datos de abajo (obtenidos recientemente de DexScreener/GeckoTerminal/CoinGecko o Twelve Data) y con lo que sepas de la empresa o proyecto, del sector, del contexto macro y del comportamiento típico de este tipo de activos.

Responde en español, claro y directo, con estas secciones:
1. Situación actual (2-3 frases).
2. Lectura de las velas: tendencia, estructura, volumen, momentum.
3. Niveles clave (soportes/resistencias) con precio.
4. Escenarios para las próximas horas: alcista, lateral y bajista, cada uno con condición, objetivo, invalidación y una probabilidad aproximada que sume 100%.
5. Riesgos específicos según el tipo de activo (en cripto: liquidez, rug, concentración, narrativa; en bolsa: resultados, macro, tipos de interés, sector, sobreextensión).
6. Qué vigilar ahora.
No inventes datos que no estén aquí; si algo no se puede saber, dilo. Termina con una línea recordando que no es consejo financiero.

DATOS:
${JSON.stringify(data)}`;
  }

  async function runAI() {
    const out = $("#aiOut");
    if (!S.apiKey) {
      out.hidden = false;
      out.textContent = "Para el análisis IA dentro de la app, añade tu API key de Anthropic en Ajustes (console.anthropic.com → API keys). Sin key: pulsa «Copiar para Claude» y pégalo en la app de Claude.";
      return;
    }
    out.hidden = false; out.textContent = "Claude está analizando las velas y el mercado…";
    $("#aiBtn").disabled = true;
    try {
      const r = await fetch(API.claude, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": S.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "server-side-fallback-2026-07-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-opus-5-5",
          max_tokens: 16000,
          thinking: { type: "adaptive" },
          output_config: { effort: "medium" },
          fallbacks: "default",
          messages: [{ role: "user", content: buildPrompt() }],
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = j?.error?.message || `HTTP ${r.status}`;
        out.textContent = r.status === 401 ? "API key no válida. Revísala en Ajustes."
          : r.status === 429 ? "Demasiadas peticiones o sin saldo en tu cuenta de Anthropic. Espera un poco y reintenta."
          : "Error de la API de Claude: " + msg;
        return;
      }
      if (j.stop_reason === "refusal") { out.textContent = "Claude no ha podido analizar este token. Prueba de nuevo o usa «Copiar para Claude»."; return; }
      const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      out.textContent = text || "Respuesta vacía. Reintenta.";
    } catch (e) {
      out.textContent = "No se pudo conectar con Claude: " + e.message;
    } finally { $("#aiBtn").disabled = false; }
  }

  async function copy(text, okMsg) {
    try { await navigator.clipboard.writeText(text); toast(okMsg); }
    catch {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); toast(okMsg); } catch { toast("No se pudo copiar"); }
      ta.remove();
    }
  }

  // ------------------------------------------------------------ ajustes UI
  const FIELDS = ["notify", "sound", "refresh", "cooldown", "up5m", "up1h", "dn5m", "dn1h", "volX", "liqMin", "vol1hMin", "ageMinH", "top1h", "top24h", "stkIdx", "stk", "earlyMin", "apiKey"];
  const MAP = { refresh: "refreshSec", cooldown: "cooldownMin" };
  function fillSettings() {
    FIELDS.forEach((f) => {
      const el = $("#s-" + f), k = MAP[f] || f;
      if (el.type === "checkbox") el.checked = !!S[k]; else el.value = S[k];
    });
  }
  function readSettings() {
    FIELDS.forEach((f) => {
      const el = $("#s-" + f), k = MAP[f] || f;
      if (el.type === "checkbox") S[k] = el.checked;
      else if (el.type === "number") { const v = parseFloat(el.value); if (isFinite(v)) S[k] = v; }
      else S[k] = el.value.trim();
    });
    store.set("settings", S);
  }

  async function askNotify() {
    if (!("Notification" in window)) { toast("Este navegador no admite notificaciones. En iPhone: añade la app a la pantalla de inicio."); return; }
    const p = await Notification.requestPermission();
    toast(p === "granted" ? "Notificaciones activadas" : "Notificaciones bloqueadas en el navegador");
    renderAlerts();
  }

  // ------------------------------------------------------------ eventos
  function setView(v) {
    state.view = v;
    document.querySelectorAll(".view").forEach((s) => (s.hidden = s.id !== "view-" + v));
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
    if (v === "alerts") { unseen = 0; store.set("unseen", 0); }
    if (v === "settings") fillSettings();
    renderAll();
    window.scrollTo(0, 0);
  }

  function unlockAudio() { if (S.sound) { try { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch { } } }

  function bind() {
    $("#tabs").addEventListener("click", (e) => { const b = e.target.closest(".tab"); if (b) setView(b.dataset.v); });
    document.addEventListener("click", unlockAudio, { once: true });
    $("#radarFilter").addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      state.radarFilter = b.dataset.f;
      document.querySelectorAll("#radarFilter .chip").forEach((c) => c.classList.toggle("on", c === b));
      renderRadar();
    });
    $("#sort").addEventListener("change", renderRadar);
    $("#chain").value = S.chain;
    $("#chain").addEventListener("change", (e) => {
      S.chain = e.target.value; store.set("settings", S);
      state.radar = []; $("#radarList").innerHTML = `<div class="empty">Cargando ${esc(S.chain)}…</div>`;
      tick();
    });
    $("#topSort").addEventListener("change", renderTop);
    $("#stkSort").addEventListener("change", renderStocks);
    $("#stkSearch").addEventListener("input", renderStocks);
    $("#stkGroups").addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      state.stkGroup = b.dataset.g; renderStocks();
    });
    $("#stkList").addEventListener("click", (e) => {
      const row = e.target.closest(".row-t"); if (!row) return;
      const t = findToken(row.dataset.id); if (t) openDetail(t);
    });
    $("#topSearch").addEventListener("input", renderTop);
    const openFrom = (e) => {
      const row = e.target.closest(".row-t"); if (!row) return;
      const t = findToken(row.dataset.id); if (t) openDetail(t);
    };
    $("#radarList").addEventListener("click", openFrom);
    $("#topList").addEventListener("click", openFrom);
    $("#alertList").addEventListener("click", async (e) => {
      const el = e.target.closest(".alert"); if (!el) return;
      const a = alerts[+el.dataset.alert];
      let t = findToken(a.id);
      if (!t && a.kind === "dex") { const r = await pairsFor(a.chain, [a.address]); t = r[0]; if (t) t.flags = []; }
      if (t) openDetail(t); else toast("Ese token ya no está en el radar");
    });
    $("#clearAlerts").addEventListener("click", () => { alerts = []; persistAlerts(); renderAlerts(); });
    $("#enableNotif").addEventListener("click", askNotify);
    $("#addToken").addEventListener("submit", async (e) => {
      e.preventDefault();
      const addr = $("#addAddr").value.trim();
      if (!addr) return;
      toast("Buscando token…");
      const r = await pairsFor(S.chain, [addr]);
      if (!r.length) { toast(`No encontré ese contrato en ${S.chain}`); return; }
      const t = r[0];
      if (!isWatched(t)) watch.push({ chain: t.chain, address: t.address, symbol: t.symbol });
      store.set("watch", watch);
      $("#addAddr").value = "";
      toast(`${t.symbol} añadido a tu lista`);
      t.flags = evaluateDex(t);
      if (!state.radar.some((x) => x.id === t.id)) state.radar.push(t);
      renderRadar(); openDetail(t);
    });
    $("#sheetClose").addEventListener("click", closeDetail);
    $("#dStar").addEventListener("click", () => {
      const t = state.detail; if (t.kind !== "dex") return;
      if (isWatched(t)) watch = watch.filter((w) => !(w.chain === t.chain && w.address === t.address));
      else watch.push({ chain: t.chain, address: t.address, symbol: t.symbol });
      store.set("watch", watch);
      toast(isWatched(t) ? `${t.symbol} en tu lista: avisos más sensibles` : `${t.symbol} quitado de tu lista`);
      refreshDetailHeader();
    });
    $("#tfs").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      state.tf = b.dataset.tf; renderTfs(); loadCandles();
    });
    $("#aiBtn").addEventListener("click", runAI);
    $("#copyBtn").addEventListener("click", () => copy(buildPrompt(), "Copiado: pégalo en Claude"));
    $("#settingsForm").addEventListener("submit", (e) => {
      e.preventDefault(); readSettings(); schedule();
      state.radar.forEach((t) => (t.flags = evaluateDex(t)));
      state.top.forEach((t) => (t.flags = evaluateTop(t)));
      state.stocks.forEach((t) => (t.flags = evaluateStk(t)));
      $("#savedMsg").hidden = false; setTimeout(() => ($("#savedMsg").hidden = true), 2000);
      if (S.notify && "Notification" in window && Notification.permission === "default") askNotify();
    });
    $("#resetSettings").addEventListener("click", () => { const k = S.apiKey; S = Object.assign({}, DEFAULTS, { apiKey: k }); store.set("settings", S); fillSettings(); toast("Valores por defecto restaurados"); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.detail) closeDetail(); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
  }

  // ------------------------------------------------------------ arranque
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => { });
  bind();
  renderAll();
  tick();
  schedule();
  window.BV = { state, evaluateDex, evaluateTop, evaluateStk, normPair }; // para pruebas
})();
