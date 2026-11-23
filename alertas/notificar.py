"""Envío de avisos: Telegram (si hay token) y siempre por consola."""
import json
import os
import urllib.parse
import urllib.request

ICONOS = {"subida": "🚀", "bajada": "🔻", "volumen": "📈"}
TITULOS = {"subida": "SUBIDA FUERTE", "bajada": "BAJADA FUERTE", "volumen": "PICO DE VOLUMEN"}


def _usd(x):
    if x is None:
        return "?"
    if x >= 1e9:
        return f"${x / 1e9:.2f}B"
    if x >= 1e6:
        return f"${x / 1e6:.2f}M"
    if x >= 1e3:
        return f"${x / 1e3:.1f}K"
    if x >= 1:
        return f"${x:,.2f}"
    return f"${x:.8f}".rstrip("0")


def _pct(x):
    return "?" if x is None else f"{x:+.1f}%"


def formatear(m, alertas, riesgos):
    tipo = alertas[0][1]
    lineas = [f"{ICONOS[tipo]} {TITULOS[tipo]} | {m['nombre']} ({m['simbolo']})"
              + (f" · {m['cadena']}" if m.get("cadena") else "")
              + (f" · #{m['rank']}" if m.get("rank") else "")]
    lineas.append("Motivo: " + "; ".join(a[2] for a in alertas))
    cambios = " | ".join(f"{k}: {_pct(v)}" for k, v in m["cambio"].items() if v is not None)
    lineas.append(f"Precio: {_usd(m['precio'])} | {cambios}")
    extra = [f"MC: {_usd(m['mcap'])}"]
    if m.get("liquidez") is not None:
        extra.append(f"Liquidez: {_usd(m['liquidez'])}")
    if m.get("vol_1h") is not None:
        extra.append(f"Vol 1h: {_usd(m['vol_1h'])}")
    elif m.get("vol_24h") is not None:
        extra.append(f"Vol 24h: {_usd(m['vol_24h'])}")
    lineas.append(" | ".join(extra))
    if m.get("compras_1h") is not None:
        lineas.append(f"Compras/ventas 1h: {m['compras_1h']}/{m['ventas_1h']}")
    if riesgos:
        lineas.append("⚠️ " + "; ".join(riesgos))
    if m.get("url"):
        lineas.append(m["url"])
    return "\n".join(lineas)


def enviar(texto, dry_run=False):
    print("\n" + texto + "\n" + "-" * 40, flush=True)
    token = os.environ.get("TELEGRAM_TOKEN")
    chat = os.environ.get("TELEGRAM_CHAT_ID")
    if dry_run or not token or not chat:
        return
    data = urllib.parse.urlencode({"chat_id": chat, "text": texto,
                                   "disable_web_page_preview": "true"}).encode()
    try:
        urllib.request.urlopen(f"https://api.telegram.org/bot{token}/sendMessage", data=data, timeout=15)
    except Exception as e:  # no tumbar el bot por un fallo de Telegram
        print(f"[aviso] Telegram falló: {e}")


def comprobar_telegram():
    token = os.environ.get("TELEGRAM_TOKEN")
    if not token:
        return "TELEGRAM_TOKEN no configurado: los avisos solo saldrán por consola."
    try:
        with urllib.request.urlopen(f"https://api.telegram.org/bot{token}/getMe", timeout=15) as r:
            info = json.loads(r.read())
        return f"Telegram OK: bot @{info['result']['username']}"
    except Exception as e:
        return f"Telegram no responde: {e}"
