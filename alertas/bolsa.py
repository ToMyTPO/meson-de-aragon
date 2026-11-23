"""Descarga cotizaciones y velas de bolsa (API de Twelve Data) y las guarda como JSON para la app.

Necesita la variable de entorno TWELVEDATA_API_KEY (clave gratuita de twelvedata.com).
Plan gratuito: 800 créditos/día y 8 por minuto; cada valor gasta 2 créditos por ejecución.

Uso: python -m alertas.bolsa --lista bolsa.json --salida app/data

Genera:
  <salida>/bolsa.json            resumen de todos los valores
  <salida>/velas/<archivo>.json   velas 15m (~5 días) y 1D (~1 año) de cada valor
"""
import argparse
import calendar
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.twelvedata.com/time_series"
PAUSA = 8  # segundos entre peticiones: el plan gratuito permite 8 por minuto


def archivo(sym):
    return re.sub(r"[^A-Za-z0-9]", "_", sym)


def get(sym, intervalo, cantidad, clave):
    q = urllib.parse.urlencode({"symbol": sym, "interval": intervalo, "outputsize": cantidad,
                                "timezone": "UTC", "apikey": clave})
    req = urllib.request.Request(f"{API}?{q}", headers={"User-Agent": "beyondvision/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.loads(r.read())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        raise RuntimeError(f"{sym} {intervalo}: {e}") from None  # sin la URL: lleva la clave
    if data.get("status") != "ok":
        raise RuntimeError(f"{sym} {intervalo}: {data.get('message') or 'sin datos'}")
    return data


def epoch(s):
    fmt = "%Y-%m-%d %H:%M:%S" if " " in s else "%Y-%m-%d"
    return calendar.timegm(time.strptime(s, fmt))


def velas(data):
    out = []
    for v in data.get("values") or []:
        try:
            out.append([epoch(v["datetime"]), float(v["open"]), float(v["high"]), float(v["low"]),
                        float(v["close"]), int(float(v.get("volume") or 0))])
        except (KeyError, ValueError):
            continue
    return sorted(out)


def cambio(a, b):
    return round((a / b - 1) * 100, 2) if a and b else None


def resumen(sym, nombre, grupo, diario, intradia, meta):
    closes = [k[4] for k in diario]
    precio = intradia[-1][4] if intradia else (closes[-1] if closes else None)
    # Último día del intradía = sesión actual: el cierre previo es el del día anterior
    hoy = time.strftime("%Y-%m-%d", time.gmtime(intradia[-1][0])) if intradia else None
    previos = [k for k in diario if time.strftime("%Y-%m-%d", time.gmtime(k[0])) != hoy]
    prev = previos[-1][4] if previos else None
    ultimo_dia = [k for k in intradia if time.strftime("%Y-%m-%d", time.gmtime(k[0])) == hoy]
    anio = diario[-252:] if diario else []
    return {
        "symbol": sym, "name": nombre, "group": grupo, "file": archivo(sym),
        "price": precio, "currency": meta.get("currency"), "exchange": meta.get("exchange"),
        "time": intradia[-1][0] if intradia else None,
        "ch": {
            "1d": cambio(precio, prev),
            "5d": cambio(precio, closes[-6] if len(closes) >= 6 else None),
            "1m": cambio(precio, closes[-22] if len(closes) >= 22 else None),
            "1y": cambio(precio, anio[0][4] if anio else None),
        },
        "high52": max((k[2] for k in anio), default=None), "low52": min((k[3] for k in anio), default=None),
        "dayHigh": max((k[2] for k in ultimo_dia), default=None), "dayLow": min((k[3] for k in ultimo_dia), default=None),
        "volume": sum(k[5] for k in ultimo_dia) or None,
    }


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--lista", default="bolsa.json")
    ap.add_argument("--salida", default="app/data")
    args = ap.parse_args(argv)

    clave = os.environ.get("TWELVEDATA_API_KEY", "").strip()
    if not clave:
        print("[aviso] falta el secreto TWELVEDATA_API_KEY: se omite la bolsa", file=sys.stderr)
        return 0

    with open(args.lista, encoding="utf-8") as f:
        lista = json.load(f)
    os.makedirs(os.path.join(args.salida, "velas"), exist_ok=True)

    items, fallos = [], []
    primera = True
    for grupo, valores in lista.items():
        for sym, nombre in valores:
            if not items and len(fallos) >= 3:
                print("[error] la API rechaza las peticiones; revisa la clave o el límite diario", file=sys.stderr)
                break
            try:
                if not primera:
                    time.sleep(PAUSA)
                primera = False
                intra = get(sym, "15min", 160, clave)
                time.sleep(PAUSA)
                diario = get(sym, "1day", 260, clave)
            except RuntimeError as e:
                fallos.append(str(e))
                print(f"[aviso] {e}", file=sys.stderr)
                continue
            vi, vd = velas(intra), velas(diario)
            with open(os.path.join(args.salida, "velas", archivo(sym) + ".json"), "w", encoding="utf-8") as f:
                json.dump({"15m": vi, "1D": vd}, f, separators=(",", ":"))
            items.append(resumen(sym, nombre, grupo, vd, vi, diario.get("meta") or {}))
        else:
            continue
        break

    salida = {"updated": int(time.time()), "source": "Twelve Data", "items": items, "failed": fallos}
    with open(os.path.join(args.salida, "bolsa.json"), "w", encoding="utf-8") as f:
        json.dump(salida, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(items)} valores guardados, {len(fallos)} fallos")
    return 0 if items else 1


if __name__ == "__main__":
    sys.exit(main())
