import json
import os
import tempfile
import time
import unittest
from unittest import mock

from alertas import bolsa


def respuesta(n, precio_final, intervalo):
    t0 = int(time.time()) - n * intervalo
    closes = [100 + i for i in range(n - 1)] + [precio_final]
    return {
        "meta": {"regularMarketPrice": precio_final, "currency": "USD", "fullExchangeName": "SNP",
                 "regularMarketTime": t0 + n * intervalo, "fiftyTwoWeekHigh": 400, "fiftyTwoWeekLow": 90},
        "timestamp": [t0 + i * intervalo for i in range(n)],
        "indicators": {"quote": [{
            "open": closes, "high": [c + 1 for c in closes], "low": [c - 1 for c in closes],
            "close": closes, "volume": [1000] * (n - 2) + [None, 500],
        }]},
    }


class TestBolsa(unittest.TestCase):
    def test_genera_resumen_y_velas(self):
        def falso(sym, rng, itv, intentos=3):
            if sym == "FALLA":
                raise RuntimeError("FALLA 1y/1d: sin datos")
            return respuesta(250, 360.0, 86400) if itv == "1d" else respuesta(130, 360.0, 900)

        with tempfile.TemporaryDirectory() as d:
            lista = os.path.join(d, "lista.json")
            with open(lista, "w") as f:
                json.dump({"indices": [["^GSPC", "S&P 500"], ["FALLA", "Falla"]]}, f)
            with mock.patch.object(bolsa, "get", side_effect=falso), mock.patch.object(bolsa.time, "sleep"):
                self.assertEqual(bolsa.main(["--lista", lista, "--salida", d]), 0)
            with open(os.path.join(d, "bolsa.json")) as f:
                res = json.load(f)
            self.assertEqual(len(res["items"]), 1)
            self.assertEqual(len(res["failed"]), 1)
            it = res["items"][0]
            self.assertEqual(it["group"], "Índices")
            self.assertEqual(it["file"], "_GSPC")
            # Último cierre previo = 100 + 248 = 348 → 360/348
            self.assertAlmostEqual(it["ch"]["1d"], round((360 / 348 - 1) * 100, 2))
            with open(os.path.join(d, "velas", "_GSPC.json")) as f:
                v = json.load(f)
            self.assertEqual(len(v["1D"]), 250)
            self.assertEqual(v["15m"][-1][4], 360.0)

    def test_sin_datos_devuelve_error(self):
        with tempfile.TemporaryDirectory() as d:
            lista = os.path.join(d, "lista.json")
            with open(lista, "w") as f:
                json.dump({"eeuu": [["X", "X"]]}, f)
            with mock.patch.object(bolsa, "get", side_effect=RuntimeError("x")):
                self.assertEqual(bolsa.main(["--lista", lista, "--salida", d]), 1)


if __name__ == "__main__":
    unittest.main()
