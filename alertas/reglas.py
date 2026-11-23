"""Reglas de alerta: deciden qué movimientos merecen un aviso."""


def pasa_filtros_dex(m, filtros):
    """Descarta tokens con liquidez/volumen ridículos o recién creados (casi siempre ruido o rug)."""
    if (m["liquidez"] or 0) < filtros.get("liquidez_min_usd", 0):
        return False
    if (m["vol_1h"] or 0) < filtros.get("volumen_1h_min_usd", 0):
        return False
    edad_min = filtros.get("edad_min_horas", 0)
    if edad_min and m["edad_h"] is not None and m["edad_h"] < edad_min:
        return False
    mcap_max = filtros.get("mcap_max_usd")
    if mcap_max and (m["mcap"] or 0) > mcap_max:
        return False
    return True


def evaluar(m, umbrales):
    """Devuelve una lista de (clave_regla, tipo, texto) para la moneda `m`.

    `umbrales` = {"subida": {"5m": 25, "1h": 50}, "bajada": {"5m": -25, "1h": -40},
                  "volumen_x": 4, "volumen_5m_min_usd": 5000}
    """
    alertas = []
    for ventana, limite in (umbrales.get("subida") or {}).items():
        v = m["cambio"].get(ventana)
        if v is not None and v >= limite:
            alertas.append((f"subida_{ventana}", "subida", f"+{v:.1f}% en {ventana}"))
    for ventana, limite in (umbrales.get("bajada") or {}).items():
        v = m["cambio"].get(ventana)
        if v is not None and v <= limite:
            alertas.append((f"bajada_{ventana}", "bajada", f"{v:.1f}% en {ventana}"))

    # Pico de volumen: volumen de los últimos 5 min frente a la media de 5 min de la última hora
    factor = umbrales.get("volumen_x")
    if factor and m["vol_5m"] and m["vol_1h"]:
        media_5m = m["vol_1h"] / 12
        if (media_5m > 0 and m["vol_5m"] >= factor * media_5m
                and m["vol_5m"] >= umbrales.get("volumen_5m_min_usd", 0)):
            alertas.append(("volumen", "volumen",
                            f"volumen 5m x{m['vol_5m'] / media_5m:.1f} sobre la media"))
    return alertas


def banderas_riesgo(m):
    """Señales de riesgo visibles con los datos públicos (no garantizan nada)."""
    b = []
    if m["fuente"] != "dex":
        return b
    if m["edad_h"] is not None and m["edad_h"] < 24:
        b.append(f"token muy nuevo ({m['edad_h']:.0f}h)")
    if m["liquidez"] and m["mcap"] and m["liquidez"] / m["mcap"] < 0.05:
        b.append("liquidez muy baja frente al market cap")
    if m["liquidez"] is not None and m["liquidez"] < 25_000:
        b.append("liquidez < $25K: slippage alto")
    c, v = m["compras_1h"], m["ventas_1h"]
    if c is not None and v is not None and v > 2 * max(c, 1):
        b.append(f"muchas más ventas que compras en 1h ({v} vs {c})")
    return b
