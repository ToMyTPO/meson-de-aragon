"""Descarga cotizaciones y velas de bolsa (Yahoo Finance) y las guarda como JSON para la app.

Uso: python -m alertas.bolsa --lista bolsa.json --salida app/data

Genera:
  <salida>/bolsa.json            resumen de todos los valores
  <salida>/velas/<archivo>.json   velas 15m (5 días) y 1D (1 año) de cada valor
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

URL = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range={rng}&interval={itv}&includePrePost=false"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
GRUPOS = {"indices": "Índices", "eeuu": "EE. UU.", "espana": "España", "materias": "Materias y divisas", "etf": "ETF"}


def archivo(sym):
    return re.sub(r"[^A-Za-z0-9]", "_", sym)


def get(sym, rng, itv, intentos=3):
    url = URL.format(sym=urllib.parse.quote(sym), rng=rng, itv=itv)
    err = None
    for i in range(intentos):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=20) as r:
                data = json.loads(r.read())
            res = (data.get("chart") or {}).get("result")
            if not res:
                raise ValueError((data.get("chart") or {}).get("error") or "sin datos")
            return res[0]
        except (urllib.error.URLError, ValueError, TimeoutError, json.JSONDecodeError) as e:
            err = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"{sym} {rng}/{itv}: {err}")


def velas(res):
    ts = res.get("timestamp") or []
    q = ((res.get("indicators") or {}).get("quote") or [{}])[0]
    out = []
    for i, t in enumerate(ts):
        o, h, l, c = (q.get(k, [None] * len(ts))[i] for k in ("open", "high", "low", "close"))
        if None in (o, h, l, c):
            continue
        v = (q.get("volume") or [0] * len(ts))[i] or 0
        out.append([t, round(o, 6), round(h, 6), round(l, 6), round(c, 6), int(v)])
    return out


def cambio(a, b):
    return round((a / b - 1) * 100, 2) if a and b else None


def resumen(sym, nombre, grupo, diario, intradia):
    meta = diario.get("meta") or {}
    d = velas(diario)
    closes = [k[4] for k in d]
    precio = meta.get("regularMarketPrice") or (closes[-1] if closes else None)
    # La vela diaria más reciente es la sesión actual (o la última cerrada)
    prev = closes[-2] if len(closes) >= 2 else meta.get("chartPreviousClose")
    return {
        "symbol": sym, "name": nombre, "group": grupo, "file": archivo(sym),
        "price": precio, "currency": meta.get("currency"),
        "exchange": meta.get("fullExchangeName") or meta.get("exchangeName"),
        "time": meta.get("regularMarketTime"),
        "ch": {
            "1d": cambio(precio, prev),
            "5d": cambio(precio, closes[-6] if len(closes) >= 6 else None),
            "1m": cambio(precio, closes[-22] if len(closes) >= 22 else None),
            "1y": cambio(precio, closes[0] if closes else None),
        },
        "high52": meta.get("fiftyTwoWeekHigh"), "low52": meta.get("fiftyTwoWeekLow"),
        "dayHigh": meta.get("regularMarketDayHigh"), "dayLow": meta.get("regularMarketDayLow"),
        "volume": meta.get("regularMarketVolume"),
        "intraday_points": len(intradia),
    }


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--lista", default="bolsa.json")
    ap.add_argument("--salida", default="app/data")
    args = ap.parse_args(argv)

    with open(args.lista, encoding="utf-8") as f:
        lista = json.load(f)
    os.makedirs(os.path.join(args.salida, "velas"), exist_ok=True)

    items, fallos = [], []
    for grupo, valores in lista.items():
        for sym, nombre in valores:
            try:
                diario = get(sym, "1y", "1d")
                intra = get(sym, "5d", "15m")
            except RuntimeError as e:
                fallos.append(str(e))
                print(f"[aviso] {e}", file=sys.stderr)
                continue
            vi, vd = velas(intra), velas(diario)
            with open(os.path.join(args.salida, "velas", archivo(sym) + ".json"), "w", encoding="utf-8") as f:
                json.dump({"15m": vi, "1D": vd}, f, separators=(",", ":"))
            items.append(resumen(sym, nombre, GRUPOS.get(grupo, grupo), diario, vi))
            time.sleep(0.3)  # no saturar la fuente

    salida = {"updated": int(time.time()), "source": "Yahoo Finance", "items": items, "failed": fallos}
    with open(os.path.join(args.salida, "bolsa.json"), "w", encoding="utf-8") as f:
        json.dump(salida, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(items)} valores guardados, {len(fallos)} fallos")
    # Falla solo si no se pudo descargar nada
    return 0 if items else 1


if __name__ == "__main__":
    sys.exit(main())
