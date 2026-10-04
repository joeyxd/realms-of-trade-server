# Revisión del intento v0 («Realms of Trade Server»)

Fecha de la revisión: 2026-10-01. El código original está intacto en `legacy/v0-socketio-server/`
(se movió de la raíz del repo; los `.zip`/`.tar.gz` eran copias antiguas del mismo código y se borraron:
siguen en el historial de git, commit `dd1d0a4`).

## Qué era

- **Solo el servidor** de un MMO **2D top-down** (coordenadas `x, y` en píxeles, mundo 3200×3200, radio de
  colisión 16 px). El cliente nunca estuvo en este repo: vivía en dominios `*.space.minimax.io` (generado por
  «MiniMax Agent», según `package.json`).
- Node 18 + Express 5 + Socket.io 4. Eventos `player:join / move / shoot / hit`, proyectiles con `setInterval`
  a 20 Hz, rate-limiter por acción, 4 armas (pistola, ráfaga, escopeta, cañón pesado) y 3 clases.

## Qué se puede aprovechar

| Pieza | Cómo la reutilizamos |
|---|---|
| Idea de servidor Node con Socket.io/WebSocket + `/health` | El servidor real del MMO (después de M6) será Node y **ejecutará los mismos módulos `src/sim/`** que hoy corren en el Web Worker. `WsTransport` ya tiene la misma interfaz. |
| `RateLimiter` (ventana por acción) | Patrón válido; en el servidor real se sustituye por token-bucket por cliente y por tipo de mensaje. |
| Validación de entrada (`utils/validation.js`) | El patrón se mantiene: el servidor valida cada `input` (rango de ejes, botones conocidos, ritmo ≤ 60/s). |
| Catálogo de armas (cooldown, nº de proyectiles, dispersión, daño) | Inspira los **módulos de cañón** del sistema naval (`data/ship_modules.js`, ganchos de M6). |
| Clases warrior/mage/ranger | No entran en esta rebanada; posible base para «oficios» de tripulación. |

## Qué NO hay que repetir (problemas encontrados)

1. **El cliente es autoritativo.** `player:move` acepta la `x, y` que manda el cliente (solo la recorta al mapa):
   se puede teletransportar. `player:hit` lo reporta el cliente. `player:shoot` usa el origen `x, y` del
   cliente, no la posición del jugador. `player:join` acepta `maxHp`, `attack`, `defense`… del cliente.
   → En el diseño nuevo el cliente solo envía **inputs** (ejes + botones); el servidor simula y decide golpes.
2. **Simulación ligada al reloj de pared.** Proyectiles avanzan «10 px por tick» con `setInterval` y caducan con
   `Date.now()`: si el intervalo se retrasa, cambia la física. → Paso fijo 60 Hz con acumulador y ticks enteros.
3. **CORS incoherente.** `ALLOWED_ORIGINS` del `.env`/`render.yaml` se ignora (lista fija en el código) y
   `app.use(cors())` deja HTTP abierto a todo el mundo.
4. **Bugs de valores por defecto con `||`**: `data.x || random` trata `0` como «sin valor»;
   `currentHp` usa `DEFAULT_HP` aunque `maxHp` sea otro.
5. **Respawn aleatorio en todo el mapa**, sin zonas seguras.
6. **Sin tests** (`npm test` falla a propósito) y sin determinismo → imposible reproducir bugs.
7. `projectiles:update` reenvía **todos** los proyectiles a **todos** cada 50 ms: no escala a bullet hell.
   → Los proyectiles se generan de forma determinista a partir de eventos de patrón (semilla + tick) y el cliente
   los simula localmente; solo se sincronizan nacimientos, reflejos y destrucciones.

## Conclusión

El v0 sirve como referencia de «qué evitar» y como plantilla de despliegue en Render. El juego nuevo
(«MAREA NEGRA», ver `DESIGN.md`) es un action-RPG isométrico 3D en Three.js con una arquitectura MMO-ready
desde el día uno; ningún archivo del v0 se importa en el código nuevo.
