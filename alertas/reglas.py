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
    minimo = umbrales.get("senal_min")
    if minimo:
        puntos, motivos = senal_temprana(m)
        if puntos >= minimo:
            alertas.insert(0, ("senal", "senal", f"señal {puntos}/100: " + ", ".join(motivos)))
    return alertas


def senal_temprana(m):
    """Puntúa de 0 a 100 si un memecoin muestra señales de INICIO de subida (no si ya explotó).

    Combina aceleración de volumen, presión compradora, actividad y liquidez. No predice nada:
    marca patrones que a menudo preceden a subidas fuertes, y que muchas veces fallan.
    """
    if m["fuente"] != "dex" or (m["liquidez"] or 0) < 15_000:
        return 0, []
    puntos, motivos = 0, []
    v5, v1 = m["vol_5m"] or 0, m["vol_1h"] or 0
    media5 = v1 / 12 if v1 else 0
    if media5 > 0:
        acel = v5 / media5
        if acel >= 3:
            puntos += 35; motivos.append(f"volumen 5m x{acel:.1f} sobre la media")
        elif acel >= 2:
            puntos += 25; motivos.append(f"volumen 5m x{acel:.1f} sobre la media")
    c5, s5 = m.get("compras_5m"), m.get("ventas_5m")
    if c5 is not None and s5 is not None and c5 + s5 >= 20:
        ratio = c5 / max(s5, 1)
        if ratio >= 2.5:
            puntos += 25; motivos.append(f"compras/ventas 5m {c5}/{s5}")
        elif ratio >= 1.5:
            puntos += 20; motivos.append(f"compras/ventas 5m {c5}/{s5}")
        if c5 + s5 >= 60:
            puntos += 10; motivos.append(f"{c5 + s5} operaciones en 5 min")
    p5, p1, p24 = (m["cambio"].get(k) for k in ("5m", "1h", "24h"))
    if p5 is not None and 3 <= p5 <= 25:
        puntos += 15; motivos.append(f"precio {p5:+.1f}% en 5m (arrancando)")
    if p1 is not None and 0 <= p1 <= 60:
        puntos += 10
    if (m["liquidez"] or 0) >= 30_000:
        puntos += 10
    if m["edad_h"] is not None and 1 <= m["edad_h"] <= 72:
        puntos += 5
    # Penalizar lo que ya explotó: la señal busca arranques, no techos
    castigo = 0
    if p24 is not None and p24 > 300:
        castigo = 40; motivos.append(f"ya subió {p24:.0f}% en 24h (tarde)")
    elif p24 is not None and p24 > 100:
        castigo = 15; motivos.append(f"ya subió {p24:.0f}% en 24h")
    return max(0, min(100, puntos) - castigo), motivos


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
    p1 = m["cambio"].get("1h")
    c5, s5 = m.get("compras_5m"), m.get("ventas_5m")
    if p1 is not None and p1 >= 100 and ((m["liquidez"] and m["mcap"] and m["liquidez"] / m["mcap"] < 0.03)
                                          or (c5 is not None and s5 is not None and s5 > 1.5 * max(c5, 1))):
        b.append("posible inflado artificial / techo: subida enorme con liquidez baja o ventas dominando")
    c, v = m["compras_1h"], m["ventas_1h"]
    if c is not None and v is not None and v > 2 * max(c, 1):
        b.append(f"muchas más ventas que compras en 1h ({v} vs {c})")
    return b
