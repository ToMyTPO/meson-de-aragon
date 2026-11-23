"""Cliente HTTP mínimo (solo librería estándar) con reintentos."""
import json
import time
import urllib.error
import urllib.request

USER_AGENT = "alertas-cripto/1.0"


def get_json(url, retries=3, timeout=20):
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last_err = e
            # 429 = límite de peticiones: esperar más antes de reintentar
            time.sleep(10 * (attempt + 1) if e.code == 429 else 2 * (attempt + 1))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            last_err = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"No se pudo obtener {url}: {last_err}")
