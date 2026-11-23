# meson-de-aragon · BeyondVision

Dos piezas que trabajan juntas:

1. **App BeyondVision** (`app/`): una app web instalable en el móvil con radar de memecoins en vivo, top 100,
   velas con indicadores, lectura técnica automática (tendencia, soportes, resistencias, escenarios), análisis con
   Claude y alertas con sonido y notificación mientras la tienes abierta.
2. **Bot de alertas** (`alertas/`): corre solo en GitHub Actions cada ~5 min y te avisa por **Telegram** aunque
   tengas el móvil apagado.

## App BeyondVision

| Pestaña | Qué hace |
|---|---|
| **Radar** | Memecoins nuevos, promocionados y en tendencia (Solana, Base, Ethereum, BNB), actualizados cada 30 s. Marca pumps, dumps, picos de volumen y riesgos (token nuevo, liquidez baja, más ventas que compras). Barra verde/roja = compras vs ventas 1 h. |
| **Cripto** | Las 100 mayores criptomonedas con cambios de 1 h, 24 h y 7 d. |
| **Bolsa** | Tu lista de acciones (S&P 500 vía ETF SPY, Nvidia, IREN, FPS, TeraWulf, Butterfly, Ouster, Coherent, Nebius) con velas, lectura técnica y alertas (±4% en el día; ±1,5% en índices). Datos de **Twelve Data**: crea una clave gratis en twelvedata.com y guárdala como secreto `TWELVEDATA_API_KEY` en Settings → Secrets and variables → Actions. Se renuevan cada 30 min en horario de EE. UU. Para cambiar la lista edita `bolsa.json` (máximo ~20 valores con el plan gratis). |
| **Alertas** | Historial de todo lo que ha saltado. Suena y manda notificación. |
| **Ajustes** | Umbrales de subida/bajada, filtros anti-basura, sonido, notificaciones y API key de Claude. |

Al tocar un token: velas (1m a 1D) con EMA 9/21, volumen, soportes (S1, S2) y resistencias (R1, R2) dibujados,
**lectura técnica** con sesgo alcista/bajista, escenarios con niveles y riesgos, y dos botones:
- **Análisis IA**: Claude analiza las velas y el contexto (requiere tu API key de Anthropic, guardada solo en tu móvil).
- **Copiar para Claude**: copia todos los datos listos para pegar en la app de Claude, sin coste extra.

### Publicarla (una vez)

1. El repo tiene que ser **público** para usar GitHub Pages gratis (Settings → General → Change visibility).
   No contiene claves: los tokens de Telegram van en Secrets.
2. **Settings → Pages → Source: GitHub Actions**.
3. Fusiona esta rama en `main`. El workflow *Publicar app* la despliega en
   `https://tomytpo.github.io/meson-de-aragon/`.

### Instalarla en el móvil

- **iPhone (Safari)**: abre la dirección → botón Compartir → *Añadir a pantalla de inicio*. Ábrela desde el icono y
  activa las notificaciones en la pestaña Alertas (iOS solo permite notificaciones a apps añadidas a inicio).
- **Android (Chrome)**: abre la dirección → menú ⋮ → *Instalar aplicación*.

> La app avisa mientras está abierta o en segundo plano reciente. Para avisos con el móvil bloqueado durante horas,
> configura también el bot de Telegram (abajo).

Probar en local: `cd app && python3 -m http.server 8000` y abre `http://localhost:8000`.

---

## Bot de alertas por Telegram

Vigila el mercado de forma automática y te avisa por **Telegram** de:

- 🚀 **Subidas fuertes** (ej. +25% en 5 min, +60% en 1 h)
- 🔻 **Bajadas fuertes** (ej. −25% en 5 min, −40% en 1 h)
- 📈 **Picos de volumen** (volumen de 5 min muy por encima de lo normal)

Qué revisa:

| Grupo | Fuente | Qué incluye |
|---|---|---|
| **Memecoins** | DexScreener | Tokens nuevos, promocionados y en tendencia de Solana (configurable), filtrando basura sin liquidez |
| **Top coins** | CoinGecko | Las 250 mayores por capitalización |
| **Tu lista** | Ambas | BTC, ETH, SOL y los tokens que añadas, con umbrales más sensibles |

Cada aviso incluye precio, cambios %, market cap, liquidez, volumen, compras/ventas y **señales de riesgo**
(token muy nuevo, liquidez baja, muchas más ventas que compras). No repite el mismo aviso durante 60 min.

Ejemplo:

```
🚀 SUBIDA FUERTE | Singularity (SING) · solana
Motivo: +30.0% en 5m; +80.0% en 1h; volumen 5m x6.0 sobre la media
Precio: $0.000674 | 5m: +30.0% | 1h: +80.0% | 6h: +200.0% | 24h: +607.9%
MC: $640.6K | Liquidez: $85.0K | Vol 1h: $120.0K
Compras/ventas 1h: 340/210
https://dexscreener.com/solana/...
```

---

## 1. Crear tu bot de Telegram (5 min)

1. En Telegram abre **@BotFather** → envía `/newbot` → ponle nombre. Te da un **token** (`123456:ABC...`).
2. Abre tu bot nuevo y envíale cualquier mensaje (ej. "hola").
3. Abre en el navegador `https://api.telegram.org/bot<TU_TOKEN>/getUpdates` y copia el número de `"chat":{"id": ...}`. Ese es tu **chat id**.

## 2. Opción A — Funciona solo, gratis, sin tu ordenador (GitHub Actions)

1. En GitHub ve al repo → **Settings → Secrets and variables → Actions → New repository secret** y crea:
   - `TELEGRAM_TOKEN` = el token del paso 1
   - `TELEGRAM_CHAT_ID` = tu chat id
2. Fusiona esta rama en `main` (los workflows programados solo se ejecutan desde la rama principal).
3. Pestaña **Actions → Alertas cripto → Run workflow** para probarlo al momento.

A partir de ahí se ejecuta **cada ~5 minutos** sola. GitHub a veces retrasa las ejecuciones programadas unos minutos.
En repos públicos es gratis; en privados consume minutos del plan gratuito (≈2.000 min/mes), así que si se acaban
puedes cambiar `*/5` por `*/15` en `.github/workflows/alertas.yml`.

## 2. Opción B — En tu ordenador o un servidor (casi tiempo real, cada 60 s)

Necesitas Python 3.10+ (no hace falta instalar librerías).

```bash
git clone https://github.com/ToMyTPO/meson-de-aragon.git
cd meson-de-aragon
export TELEGRAM_TOKEN="123456:ABC..."     # en Windows: set TELEGRAM_TOKEN=...
export TELEGRAM_CHAT_ID="987654321"
python -m alertas                          # se queda corriendo, revisa cada 60 s
```

Otras órdenes:

```bash
python -m alertas --once --dry-run   # una pasada, solo muestra en pantalla
python -m unittest discover -s tests # pruebas
```

## 3. Ajustar qué te avisa (`config.json`)

| Clave | Qué hace |
|---|---|
| `intervalo_segundos` | Cada cuánto revisa en modo continuo (opción B) |
| `enfriamiento_minutos` | Tiempo mínimo antes de repetir el mismo aviso de la misma moneda |
| `memecoins.cadenas` | Redes a vigilar: `"solana"`, `"base"`, `"ethereum"`, `"bsc"`… |
| `memecoins.filtros` | Liquidez mínima, volumen mínimo, edad mínima y market cap máximo para que un memecoin cuente |
| `*.umbrales.subida` / `bajada` | % por ventana: `5m`, `1h`, `6h`, `24h` (memecoins) o `1h`, `24h` (top coins) |
| `*.umbrales.volumen_x` | Cuántas veces sobre lo normal debe ir el volumen de 5 min |
| `top_coins.cantidad` | Cuántas monedas del top vigilar |
| `vigilar.coingecko_ids` | Monedas grandes de tu lista (id de CoinGecko, ej. `"dogecoin"`) |
| `vigilar.tokens` | Tus memecoins: `{"cadena": "solana", "direccion": "<mint>"}` |

¿Demasiados avisos? Sube los umbrales o los filtros de liquidez/volumen. ¿Muy pocos? Bájalos.

---

⚠️ Herramienta informativa, no consejo financiero. Una subida fuerte no significa que vaya a seguir subiendo:
en memecoins muchas alertas de subida son el preludio de un dump o un rug. Verifica siempre antes de operar.
