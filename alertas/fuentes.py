"""Fuentes de datos: DexScreener (memecoins / DEX) y CoinGecko (monedas grandes).

Todo se normaliza a un dict "Moneda" con las mismas claves para que las reglas
no dependan de la fuente.
"""
import time

from .http import get_json

DEX = "https://api.dexscreener.com"
CG = "https://api.coingecko.com/api/v3"
GT = "https://api.geckoterminal.com/api/v2"
GT_RED = {"solana": "solana", "ethereum": "eth", "bsc": "bsc", "base": "base"}
# Monedas base de los pares (no son memecoins)
BASES = {"So11111111111111111111111111111111111111112", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
         "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
         "0x4200000000000000000000000000000000000006", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
         "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"}


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------- DexScreener

def descubrir_tokens_dex(cadenas):
    """Tokens recientes / promocionados / en tendencia en DexScreener para las cadenas dadas."""
    direcciones = {}
    for ruta in ("/token-profiles/latest/v1", "/token-boosts/latest/v1", "/token-boosts/top/v1"):
        try:
            datos = get_json(DEX + ruta)
        except RuntimeError as e:
            print(f"[aviso] {e}")
            continue
        for item in datos if isinstance(datos, list) else []:
            cadena = item.get("chainId")
            if cadena in cadenas and item.get("tokenAddress"):
                direcciones.setdefault(cadena, set()).add(item["tokenAddress"])
    # Tendencias y pools nuevos de GeckoTerminal
    for cadena in cadenas:
        red = GT_RED.get(cadena)
        if not red:
            continue
        for q in ("trending_pools?page=1", "trending_pools?page=2", "new_pools?page=1"):
            try:
                datos = get_json(f"{GT}/networks/{red}/{q}", retries=1)
            except RuntimeError as e:
                print(f"[aviso] {e}")
                continue
            for p in datos.get("data") or []:
                tid = ((p.get("relationships") or {}).get("base_token") or {}).get("data", {}).get("id", "")
                if "_" in tid:
                    direcciones.setdefault(cadena, set()).add(tid.split("_", 1)[1])
    for cadena in direcciones:
        direcciones[cadena] = {a for a in direcciones[cadena] if a not in BASES and a.lower() not in BASES}
    return direcciones


def pares_dex(cadena, direcciones):
    """Devuelve el par con más liquidez de cada token (lotes de 30, límite de la API)."""
    direcciones = list(direcciones)
    mejores = {}
    for i in range(0, len(direcciones), 30):
        lote = ",".join(direcciones[i:i + 30])
        try:
            pares = get_json(f"{DEX}/tokens/v1/{cadena}/{lote}")
        except RuntimeError as e:
            print(f"[aviso] {e}")
            continue
        for p in pares if isinstance(pares, list) else []:
            addr = (p.get("baseToken") or {}).get("address")
            if not addr:
                continue
            liq = _f((p.get("liquidity") or {}).get("usd")) or 0
            actual = mejores.get(addr)
            if actual is None or liq > (_f((actual.get("liquidity") or {}).get("usd")) or 0):
                mejores[addr] = p
    return [normalizar_par_dex(p) for p in mejores.values()]


def normalizar_par_dex(p):
    base = p.get("baseToken") or {}
    cambio = p.get("priceChange") or {}
    vol = p.get("volume") or {}
    tx1h = (p.get("txns") or {}).get("h1") or {}
    tx5m = (p.get("txns") or {}).get("m5") or {}
    creado = p.get("pairCreatedAt")
    edad_h = (time.time() * 1000 - creado) / 3_600_000 if creado else None
    return {
        "fuente": "dex",
        "id": f"{p.get('chainId')}:{base.get('address')}",
        "nombre": base.get("name") or "?",
        "simbolo": base.get("symbol") or "?",
        "cadena": p.get("chainId"),
        "precio": _f(p.get("priceUsd")),
        "cambio": {"5m": _f(cambio.get("m5")), "1h": _f(cambio.get("h1")),
                   "6h": _f(cambio.get("h6")), "24h": _f(cambio.get("h24"))},
        "vol_5m": _f(vol.get("m5")),
        "vol_1h": _f(vol.get("h1")),
        "vol_24h": _f(vol.get("h24")),
        "liquidez": _f((p.get("liquidity") or {}).get("usd")),
        "mcap": _f(p.get("marketCap")) or _f(p.get("fdv")),
        "compras_5m": tx5m.get("buys"),
        "ventas_5m": tx5m.get("sells"),
        "compras_1h": tx1h.get("buys"),
        "ventas_1h": tx1h.get("sells"),
        "edad_h": edad_h,
        "url": p.get("url"),
    }


# ---------------------------------------------------------------- CoinGecko

def top_coingecko(cantidad=250, ids=None):
    """Top N por capitalización (o ids concretos) con cambios de 1h y 24h."""
    params = "vs_currency=usd&order=market_cap_desc&price_change_percentage=1h,24h,7d"
    urls = []
    if ids:
        urls.append(f"{CG}/coins/markets?{params}&ids={','.join(ids)}&per_page=250")
    paginas = (cantidad + 249) // 250
    for pag in range(1, paginas + 1):
        urls.append(f"{CG}/coins/markets?{params}&per_page={min(250, cantidad)}&page={pag}")
    monedas = {}
    for url in urls:
        try:
            datos = get_json(url)
        except RuntimeError as e:
            print(f"[aviso] {e}")
            continue
        for c in datos if isinstance(datos, list) else []:
            m = normalizar_coingecko(c)
            monedas[m["id"]] = m
    return list(monedas.values())


def normalizar_coingecko(c):
    return {
        "fuente": "cg",
        "id": f"cg:{c.get('id')}",
        "nombre": c.get("name") or "?",
        "simbolo": (c.get("symbol") or "?").upper(),
        "cadena": None,
        "precio": _f(c.get("current_price")),
        "cambio": {"5m": None,
                   "1h": _f(c.get("price_change_percentage_1h_in_currency")),
                   "6h": None,
                   "24h": _f(c.get("price_change_percentage_24h_in_currency")),
                   "7d": _f(c.get("price_change_percentage_7d_in_currency"))},
        "vol_5m": None,
        "vol_1h": None,
        "vol_24h": _f(c.get("total_volume")),
        "liquidez": None,
        "mcap": _f(c.get("market_cap")),
        "rank": c.get("market_cap_rank"),
        "compras_5m": None,
        "ventas_5m": None,
        "compras_1h": None,
        "ventas_1h": None,
        "edad_h": None,
        "url": f"https://www.coingecko.com/es/monedas/{c.get('id')}",
    }
