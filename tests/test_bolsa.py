import json
import os
import tempfile
import time
import unittest
from unittest import mock

from alertas import bolsa

DIA = 86400


def serie(n, paso, final, inicio):
    """Respuesta tipo Twelve Data (más reciente primero)."""
    vals = []
    for i in range(n):
        t = inicio + i * paso
        c = final if i == n - 1 else 100.0 + i
        fmt = "%Y-%m-%d %H:%M:%S" if paso < DIA else "%Y-%m-%d"
        vals.append({"datetime": time.strftime(fmt, time.gmtime(t)), "open": str(c), "high": str(c + 1),
                     "low": str(c - 1), "close": str(c), "volume": "1000"})
    return {"status": "ok", "meta": {"currency": "USD", "exchange": "NASDAQ"}, "values": vals[::-1]}


def falso(final=360.0, fallan=()):
    hoy = (int(time.time()) // DIA) * DIA
    def get(sym, intervalo, cantidad, clave):
        if sym in fallan:
            raise RuntimeError(f"{sym} {intervalo}: **symbol** not found")
        if intervalo == "1day":
            return serie(250, DIA, final, hoy - 249 * DIA)  # el último día es hoy
        return serie(26, 900, final, hoy + 14 * 3600)       # sesión de hoy
    return get


class TestBolsa(unittest.TestCase):
    def ejecutar(self, lista, get, clave="x"):
        with tempfile.TemporaryDirectory() as d:
            ruta = os.path.join(d, "lista.json")
            with open(ruta, "w") as f:
                json.dump(lista, f)
            with mock.patch.object(bolsa, "get", side_effect=get), mock.patch.object(bolsa.time, "sleep"), \
                    mock.patch.dict(os.environ, {"TWELVEDATA_API_KEY": clave}):
                code = bolsa.main(["--lista", ruta, "--salida", d])
            res = None
            if os.path.exists(os.path.join(d, "bolsa.json")):
                with open(os.path.join(d, "bolsa.json")) as f:
                    res = json.load(f)
            velas = None
            if os.path.exists(os.path.join(d, "velas", "NVDA.json")):
                with open(os.path.join(d, "velas", "NVDA.json")) as f:
                    velas = json.load(f)
            return code, res, velas

    def test_genera_resumen_y_velas(self):
        code, res, velas = self.ejecutar({"Mi lista": [["NVDA", "Nvidia"], ["FPS", "FPS"]]}, falso(fallan=("FPS",)))
        self.assertEqual(code, 0)
        self.assertEqual(len(res["items"]), 1)
        self.assertEqual(len(res["failed"]), 1)
        it = res["items"][0]
        self.assertEqual(it["group"], "Mi lista")
        # cierre previo = penúltimo día = 100 + 248
        self.assertAlmostEqual(it["ch"]["1d"], round((360 / 348 - 1) * 100, 2))
        self.assertEqual(len(velas["1D"]), 250)
        self.assertEqual(velas["15m"][-1][4], 360.0)
        self.assertLess(velas["15m"][0][0], velas["15m"][-1][0])  # orden cronológico

    def test_usa_alternativa_si_el_indice_falla(self):
        base = falso()
        def get(sym, intervalo, cantidad, clave):
            if sym in ("SPX", "GSPC"):
                raise RuntimeError(f"{sym} {intervalo}: requires a paid plan")
            return base(sym, intervalo, cantidad, clave)
        code, res, _ = self.ejecutar({"Índices": [["SPX", "S&P 500", ["GSPC", "SPY"]]]}, get)
        it = res["items"][0]
        self.assertEqual((it["symbol"], it["source_symbol"], it["file"]), ("SPX", "SPY", "SPX"))
        self.assertIn("vía SPY", it["name"])

    def test_sin_clave_no_hace_nada(self):
        code, res, _ = self.ejecutar({"a": [["NVDA", "x"]]}, falso(), clave="")
        self.assertEqual(code, 0)
        self.assertIsNone(res)

    def test_abandona_pronto_si_todo_falla(self):
        llamadas = []
        def falla(sym, intervalo, cantidad, clave):
            llamadas.append(sym)
            raise RuntimeError(f"{sym}: You have run out of API credits")
        code, res, _ = self.ejecutar({"a": [[f"S{i}", "x"] for i in range(10)]}, falla)
        self.assertEqual(code, 1)
        self.assertEqual(len(llamadas), 3)


class TestSenalBolsa(unittest.TestCase):
    def test_ruptura_con_volumen(self):
        hoy = (int(time.time()) // DIA) * DIA
        diario = [[hoy - (100 - i) * DIA, 100 + i * 0.2, 101 + i * 0.2, 99 + i * 0.2, 100 + i * 0.2, 1000] for i in range(100)]
        intra = [[hoy - DIA + 14 * 3600 + i * 900, 119, 119.5, 118.5, 119, 100] for i in range(20)]
        intra += [[hoy + 14 * 3600 + i * 900, 121, 124, 120, 123, 400] for i in range(6)]
        sig = bolsa.senal_bolsa(diario, intra, 123.0, 3.0)
        self.assertGreaterEqual(sig["score"], 70)
        self.assertIn("rompe el máximo de 20 días", sig["reasons"])

    def test_sin_historial_no_puntua(self):
        self.assertEqual(bolsa.senal_bolsa([], [], 1.0, 0)["score"], 0)


if __name__ == "__main__":
    unittest.main()
