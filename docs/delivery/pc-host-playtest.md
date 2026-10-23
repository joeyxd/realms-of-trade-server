# Prueba multijugador desde el PC — 2026-10-05

Autoría/integración: principal; GPT-6 Luna revisó contratos y escribió únicamente la prueba aislada de lifecycle.
Base de aplicación `f0b74a7`; versión `0.6.0-alpha.1`, protocolo 13 conservados. Ediciones de arte concurrentes
permanecen ajenas a esta misión. Esto sirve el checkout de trabajo; no es un release congelado ni despliegue VPS.

Durante la prueba se incorporó al checkout trabajo concurrente de M5 P3. Se conservó su carga/flush del mundo
en `createGameServer`, y el lanzador respeta `WORLD_ID`/`WORLD_SAVE_SECONDS`. No se incluye ese código ajeno
en esta misión ni se acepta aquí su diseño. El host activo reportó mundo listo, durable y cero errores.

- `JUGAR-CON-AMIGOS.cmd` y `tools/host-pc.mjs`: HTTP/WS en loopback 5173, 4 plazas, cuentas del `.env`
  conservadas, DEV apagado y orígenes locales/URL asignada. Segundo arranque reutiliza la autoridad activa.
- Selección `auto`: ngrok ya configurado; Cloudflare portable y SHA256 verificado en otros equipos.
  Puerto, plazas/bots y proveedor configurables. Accesos adicionales en `C:\DEV\real of trade`.
- `DETENER-JUEGO.cmd`: control separado de loopback con token, cierre de túnel y flush de perfiles.
  Secreto de firmas estable si el autor no aporta uno. Estado/binario/token/logs fuera de HTTP y Git.
- Puerto anterior 5173: vista previa Node verificada contra el index actual, cero jugadores al reemplazarla.
  No se arrancaron dos hosts de cuentas a la vez. No se modificó `.env`, Supabase Auth ni el DNS del sistema.
- Cloudflare conectó; el DNS local de hostnames nuevos demoró alrededor de dos minutos. ngrok ya autenticado
  resolvió de inmediato y volvió a asignar el mismo dominio. El lanzador permite forzar cualquiera de los dos.

Verificación de aceptación:

- `node --test tests/server.test.mjs tests/accounts-server.test.mjs`: **14/14**.
- `node --test tests/pc-host.test.mjs`: **1/1**, tras integración final de selección de proveedor.
  Fixture sin `.env` ni Supabase real; HTTP online, control privado, rechazo sin token, idempotencia, shutdown
  acotado y mismo secreto tras reiniciar. Solo se limpia el fixture dentro de `.scratch`.
- `tools/check-friends.mjs` pasó en localhost y por **HTTPS/WSS público de ngrok**:
  dos invitados reciben identidades distintas, ven los spawns del otro, B ve moverse a A y recibe su despawn.
  Health/index públicos correctos; `.env`, `.git`, `server/` y la sesión privada devuelven 404.
  El canario usa ticks recibidos del host, evitando que la latencia descarte comandos con `pt=0`.
- URL pública operativa al aceptar: `https://glennie-uninferable-bitingly.ngrok-free.dev`.
  Servidor y túnel quedaron encendidos en el PC; la URL/estado actual se guardan localmente y no en el repo.
- Node `v24.14.0`, GPU inventariada por `nvidia-smi`: RTX 3080 Ti Laptop GPU. El host usa CPU;
  cada navegador renderiza con su propia GPU. No se midieron FPS ni se certificó el equipo físico del amigo.

Para jugar: enviar la URL, pasar el aviso inicial de ngrok si aparece, elegir invitado o cuenta ya confirmada.
El correo de alta requiere autorizar el origen en Supabase; no se añadió automáticamente. Los invitados guardan
por hostname; Cloudflare cambia ese slot al cambiar dirección. Quotas/disponibilidad del túnel y PC encendida
siguen siendo requisitos de prueba. Próximo paso: recorrido humano desde el dispositivo del amigo;
D04 P2 (cubierta transitable) mantiene su cola y no forma parte de este trabajo.
