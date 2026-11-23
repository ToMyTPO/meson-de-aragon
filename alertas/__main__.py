"""Punto de entrada: python -m alertas [--once] [--dry-run] [--config config.json]"""
import argparse
import json
import os
import sys
import time

from . import fuentes, reglas
from .estado import Estado
from .notificar import comprobar_telegram, enviar, formatear

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def cargar_config(ruta):
    with open(ruta, encoding="utf-8") as f:
        return json.load(f)


def recoger(cfg, ciclo):
    """Devuelve lista de (moneda, umbrales) a evaluar en este ciclo."""
    trabajo = []
    dex = cfg.get("memecoins", {})
    vig = cfg.get("vigilar", {})

    if dex.get("activo", True):
        cadenas = set(dex.get("cadenas", ["solana"]))
        descubiertos = fuentes.descubrir_tokens_dex(cadenas)
        for cadena, dirs in descubiertos.items():
            for m in fuentes.pares_dex(cadena, dirs):
                if reglas.pasa_filtros_dex(m, dex.get("filtros", {})):
                    trabajo.append((m, dex["umbrales"]))

    # Tokens de tu lista (sin filtros, con sus propios umbrales)
    tokens = vig.get("tokens", [])
    por_cadena = {}
    for t in tokens:
        por_cadena.setdefault(t["cadena"], []).append(t["direccion"])
    for cadena, dirs in por_cadena.items():
        for m in fuentes.pares_dex(cadena, dirs):
            trabajo.append((m, vig["umbrales"]))

    # CoinGecko tiene un límite de peticiones bajo: solo cada N ciclos
    cg = cfg.get("top_coins", {})
    cada = max(1, cg.get("cada_n_ciclos", 5))
    if (cg.get("activo", True) or vig.get("coingecko_ids")) and ciclo % cada == 0:
        ids_vig = set(vig.get("coingecko_ids", []))
        cantidad = cg.get("cantidad", 250) if cg.get("activo", True) else 0
        for m in fuentes.top_coingecko(cantidad, ids=list(ids_vig) or None):
            if m["id"][3:] in ids_vig:
                trabajo.append((m, vig["umbrales"]))
            elif cg.get("activo", True):
                trabajo.append((m, cg["umbrales"]))

    # Quitar duplicados (un token de tu lista que también salga en tendencias)
    vistos, unicos = set(), []
    for m, u in reversed(trabajo):  # los de "vigilar" van detrás: tienen prioridad
        if m["id"] not in vistos:
            vistos.add(m["id"])
            unicos.append((m, u))
    return unicos


def giros(cfg, estado, monedas, dry_run):
    """Confirma con velas de 5 min el giro alcista de los mejores candidatos de todo el radar."""
    if not cfg.get("giro_alcista", {}).get("activo", True):
        return 0
    from .bolsa import giro_alcista
    cands = sorted(((reglas.candidato_giro(m), m) for m, _ in monedas), key=lambda x: -x[0])
    n = 0
    for puntos, m in [c for c in cands if c[0] > 0][: cfg.get("giro_alcista", {}).get("max_por_ciclo", 5)]:
        clave = f"{m['id']}|giro"
        if not estado.puede_avisar(clave, 120):
            continue
        try:
            g = giro_alcista(fuentes.velas_5m(m["cadena"], m.get("par")))
        except RuntimeError as e:
            print(f"[aviso] {e}")
            continue
        if not g["turn"]:
            continue
        enviar(formatear(m, [("giro", "giro", f"giro alcista {g['score']}/100: " + ", ".join(g["reasons"]))],
                         reglas.banderas_riesgo(m)), dry_run=dry_run)
        estado.marcar(clave)
        n += 1
    return n


def ciclo_unico(cfg, estado, ciclo, dry_run):
    monedas = recoger(cfg, ciclo)
    enfriamiento = cfg.get("enfriamiento_minutos", 60)
    enviados = 0
    for m, umbrales in monedas:
        alertas = [a for a in reglas.evaluar(m, umbrales)
                   if estado.puede_avisar(f"{m['id']}|{a[0]}", enfriamiento)]
        if not alertas:
            continue
        enviar(formatear(m, alertas, reglas.banderas_riesgo(m)), dry_run=dry_run)
        for a in alertas:
            estado.marcar(f"{m['id']}|{a[0]}")
        enviados += 1
        if enviados >= cfg.get("max_avisos_por_ciclo", 15):
            print("[aviso] límite de avisos por ciclo alcanzado")
            break
    enviados += giros(cfg, estado, monedas, dry_run)
    estado.guardar()
    print(f"[{time.strftime('%H:%M:%S')}] ciclo {ciclo}: {len(monedas)} monedas revisadas, "
          f"{enviados} avisos", flush=True)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Bot de alertas cripto")
    ap.add_argument("--config", default=os.path.join(RAIZ, "config.json"))
    ap.add_argument("--once", action="store_true", help="un solo ciclo (para cron / GitHub Actions)")
    ap.add_argument("--dry-run", action="store_true", help="no envía a Telegram, solo consola")
    ap.add_argument("--ciclos", type=int, default=1, help="con --once: cuántas revisiones hacer seguidas")
    ap.add_argument("--pausa", type=int, default=60, help="con --once: segundos entre revisiones")
    args = ap.parse_args(argv)

    cfg = cargar_config(args.config)
    estado = Estado(os.path.join(RAIZ, cfg.get("archivo_estado", "estado_alertas.json")))
    print(comprobar_telegram())

    if args.once:
        # Varias revisiones seguidas por ejecución (GitHub solo permite lanzar cada 5 min).
        # La primera consulta CoinGecko; el resto, solo memecoins.
        for i in range(max(1, args.ciclos)):
            if i:
                time.sleep(args.pausa)
            try:
                ciclo_unico(cfg, estado, i * cfg.get("top_coins", {}).get("cada_n_ciclos", 5), args.dry_run)
            except Exception as e:
                print(f"[error] {e}", file=sys.stderr)
        return 0

    intervalo = cfg.get("intervalo_segundos", 60)
    ciclo = 0
    while True:
        try:
            ciclo_unico(cfg, estado, ciclo, args.dry_run)
        except Exception as e:
            print(f"[error] {e}", file=sys.stderr)
        ciclo += 1
        time.sleep(intervalo)


if __name__ == "__main__":
    sys.exit(main())
