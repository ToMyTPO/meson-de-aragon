import os
import tempfile
import time
import unittest
from unittest import mock

from alertas import __main__ as bot
from alertas import fuentes, reglas
from alertas.estado import Estado
from alertas.notificar import formatear

PAR = {
    "chainId": "solana", "url": "https://dexscreener.com/solana/abc",
    "baseToken": {"address": "TOKEN1", "name": "Singularity", "symbol": "SING"},
    "priceUsd": "0.000674",
    "priceChange": {"m5": 30.0, "h1": 80.0, "h6": 200.0, "h24": 607.9},
    "volume": {"m5": 60000, "h1": 120000, "h6": 300000, "h24": 900000},
    "txns": {"h1": {"buys": 340, "sells": 210}},
    "liquidity": {"usd": 85000}, "marketCap": 640600,
    "pairCreatedAt": (time.time() - 3 * 86400) * 1000,
}

CG = {"id": "bitcoin", "symbol": "btc", "name": "Bitcoin", "current_price": 90000,
      "market_cap": 1.8e12, "market_cap_rank": 1, "total_volume": 4e10,
      "price_change_percentage_1h_in_currency": -7.2,
      "price_change_percentage_24h_in_currency": -3.0,
      "price_change_percentage_7d_in_currency": 1.0}

UMBRALES_DEX = {"subida": {"5m": 25, "1h": 60}, "bajada": {"5m": -25, "1h": -40},
                "volumen_x": 5, "volumen_5m_min_usd": 10000}


class TestReglas(unittest.TestCase):
    def test_subida_y_volumen(self):
        m = fuentes.normalizar_par_dex(PAR)
        claves = {a[0] for a in reglas.evaluar(m, UMBRALES_DEX)}
        self.assertEqual(claves, {"subida_5m", "subida_1h", "volumen"})

    def test_bajada_coingecko(self):
        m = fuentes.normalizar_coingecko(CG)
        al = reglas.evaluar(m, {"subida": {"1h": 6}, "bajada": {"1h": -6, "24h": -20}})
        self.assertEqual([a[0] for a in al], ["bajada_1h"])

    def test_sin_movimiento(self):
        p = dict(PAR, priceChange={"m5": 1, "h1": 2, "h6": 3, "h24": 4},
                 volume={"m5": 1000, "h1": 12000})
        self.assertEqual(reglas.evaluar(fuentes.normalizar_par_dex(p), UMBRALES_DEX), [])

    def test_filtros(self):
        m = fuentes.normalizar_par_dex(PAR)
        self.assertTrue(reglas.pasa_filtros_dex(m, {"liquidez_min_usd": 15000}))
        self.assertFalse(reglas.pasa_filtros_dex(m, {"liquidez_min_usd": 100000}))
        nuevo = fuentes.normalizar_par_dex(dict(PAR, pairCreatedAt=time.time() * 1000))
        self.assertFalse(reglas.pasa_filtros_dex(nuevo, {"edad_min_horas": 1}))

    def test_riesgos(self):
        p = dict(PAR, liquidity={"usd": 10000}, txns={"h1": {"buys": 10, "sells": 50}})
        r = reglas.banderas_riesgo(fuentes.normalizar_par_dex(p))
        self.assertTrue(any("liquidez" in x for x in r))
        self.assertTrue(any("ventas" in x for x in r))

    def test_formato(self):
        m = fuentes.normalizar_par_dex(PAR)
        txt = formatear(m, reglas.evaluar(m, UMBRALES_DEX), [])
        self.assertIn("SUBIDA FUERTE", txt)
        self.assertIn("Singularity", txt)
        self.assertIn("$640.6K", txt)


class TestSenalTemprana(unittest.TestCase):
    def par(self, **kw):
        p = dict(PAR, priceChange={"m5": 8, "h1": 20, "h6": 30, "h24": 40},
                 volume={"m5": 40000, "h1": 120000, "h6": 300000, "h24": 900000},
                 txns={"m5": {"buys": 90, "sells": 30}, "h1": {"buys": 500, "sells": 300}})
        p.update(kw)
        return fuentes.normalizar_par_dex(p)

    def test_detecta_arranque(self):
        puntos, motivos = reglas.senal_temprana(self.par())
        self.assertGreaterEqual(puntos, 70)
        al = reglas.evaluar(self.par(), {"senal_min": 70})
        self.assertEqual(al[0][0], "senal")

    def test_ya_inflado_no_es_senal_temprana(self):
        m = self.par(priceChange={"m5": 8, "h1": 20, "h6": 300, "h24": 900})
        self.assertLess(reglas.senal_temprana(m)[0], 70)

    def test_sin_liquidez_no_puntua(self):
        self.assertEqual(reglas.senal_temprana(self.par(liquidity={"usd": 5000}))[0], 0)

    def test_aviso_inflado(self):
        m = self.par(priceChange={"m5": -5, "h1": 150, "h6": 300, "h24": 400},
                     txns={"m5": {"buys": 20, "sells": 80}, "h1": {"buys": 500, "sells": 300}})
        self.assertTrue(any("inflado" in r for r in reglas.banderas_riesgo(m)))


class TestCiclo(unittest.TestCase):
    def test_ciclo_y_enfriamiento(self):
        cfg = bot.cargar_config(os.path.join(bot.RAIZ, "config.json"))
        with tempfile.TemporaryDirectory() as d, \
                mock.patch.object(fuentes, "descubrir_tokens_dex", return_value={"solana": {"TOKEN1"}}), \
                mock.patch.object(fuentes, "pares_dex", side_effect=lambda c, dirs: [fuentes.normalizar_par_dex(PAR)]), \
                mock.patch.object(fuentes, "top_coingecko", return_value=[fuentes.normalizar_coingecko(CG)]), \
                mock.patch.object(bot, "enviar") as enviar:
            estado = Estado(os.path.join(d, "e.json"))
            bot.ciclo_unico(cfg, estado, 0, dry_run=True)
            textos = [c.args[0] for c in enviar.call_args_list]
            self.assertEqual(len(textos), 2)  # SING sube, BTC (lista vigilar) baja
            self.assertTrue(any("SING" in t for t in textos))
            self.assertTrue(any("BAJADA" in t and "BTC" in t for t in textos))
            # Segundo ciclo inmediato: el enfriamiento evita repetir avisos
            enviar.reset_mock()
            bot.ciclo_unico(cfg, Estado(os.path.join(d, "e.json")), 0, dry_run=True)
            enviar.assert_not_called()


if __name__ == "__main__":
    unittest.main()
