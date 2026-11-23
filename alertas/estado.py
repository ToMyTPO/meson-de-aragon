"""Memoria de avisos ya enviados, para no repetir el mismo aviso cada minuto."""
import json
import os
import time


class Estado:
    def __init__(self, ruta):
        self.ruta = ruta
        self.datos = {}
        if os.path.exists(ruta):
            try:
                with open(ruta, encoding="utf-8") as f:
                    self.datos = json.load(f)
            except (OSError, json.JSONDecodeError):
                self.datos = {}

    def puede_avisar(self, clave, enfriamiento_min):
        ultimo = self.datos.get(clave)
        return ultimo is None or time.time() - ultimo >= enfriamiento_min * 60

    def marcar(self, clave):
        self.datos[clave] = time.time()

    def guardar(self):
        # Limpiar entradas de más de 2 días
        limite = time.time() - 2 * 86400
        self.datos = {k: v for k, v in self.datos.items() if v >= limite}
        tmp = self.ruta + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.datos, f)
        os.replace(tmp, self.ruta)
