# Jugar en línea con amigos (tu servidor por SSH)

`npm start` levanta **un solo proceso** que sirve el juego y corre el mundo. Quien abre la URL juega en línea en
la misma isla (hasta `MAX_PLAYERS`, 4 por defecto).

## Desde tu PC Windows, con un doble clic

Abre **`JUGAR-CON-AMIGOS.cmd`** en la raíz del proyecto (también hay un acceso en `C:\DEV\real of trade`).
Hace falta Node.js 22 o superior e Internet. El lanzador instala las dependencias si faltan, levanta el mundo
en **http://localhost:5173**. Si ngrok ya está instalado/configurado, usa su URL asignada; en este PC está disponible.
En otro equipo usa Cloudflare: descarga una versión oficial de `cloudflared` y verifica su SHA256 antes de usarla.
La opción Cloudflare no necesita cuenta ni dominio, instalación global, permisos de administrador o abrir el router.

Cuando la comprobación HTTPS pasa, muestra **URL PARA LOS DOS**, abre el navegador y guarda la URL en
`URL-PARA-AMIGOS.txt`. Compártela con tu amigo: los dos entráis a la misma isla. Mantén tu PC encendida,
conectada a Internet y sin suspender. El túnel usa conexiones salientes; el juego escucha solo en loopback.

Para apagarlo, **`DETENER-JUEGO.cmd`** cierra el túnel y espera el guardado de perfiles del host. En la ventana
del lanzador también sirve Ctrl+C. Usa estas opciones antes de cerrar la ventana de golpe. Un segundo doble
clic detecta el lanzador activo y muestra su URL, sin crear otra instancia.

Desde terminal, en la carpeta del proyecto:

```powershell
npm.cmd run play:friends                      # servidor + URL HTTPS + navegador
npm.cmd run play:friends -- --no-open          # sin abrir el navegador
npm.cmd run play:friends -- --tunnel ngrok     # configuración existente de ngrok
npm.cmd run play:friends -- --tunnel cloudflare # sin cuenta, hostname temporal
npm.cmd run play:friends -- --port 5180        # puerto alternativo, con la otra instancia apagada
npm.cmd run play:local                        # solo tu PC, sin túnel ni descarga
npm.cmd run play:stop                         # cierre ordenado
npm.cmd run play:check -- https://URL-DEL-JUEGO # canario HTTP + dos jugadores (necesita 2 plazas libres)
```

`MAX_PLAYERS` (4), `BOTS` (3) y `PC_TUNNEL` (`auto`, `ngrok` o `cloudflare`) se pueden cambiar en `.env`.
Conserva las cuentas/Supabase configuradas allí;
para entrar sin registro, elige **Jugar como invitado**. El lanzador fuerza DEV desactivado y permite los orígenes
locales y el HTTPS asignado. No ejecutes otra autoridad con las mismas cuentas a la vez: las reservas de M5
todavía son de un proceso. Si 5173 está ocupado por una vista previa antigua, ciérrala antes de iniciar.

El secreto de guardado existente se conserva. Si no hay `SAVE_SECRET`, el lanzador genera uno estable en
`.scratch/pc-host/save-secret`, privado y fuera de los archivos servidos/Git. No lo borres si quieres conservar
las firmas de invitados. Sesión, control de apagado, binario y log del túnel viven también en `.scratch/pc-host/`;
el control de apagado escucha en otro puerto de loopback y exige un token que nunca publica el juego.

La URL deja de servir el juego al apagar el lanzador; quien tenga el enlace puede entrar mientras está encendido.
Si ngrok muestra su aviso inicial, pulsa **Visit Site**. Su dominio de desarrollo está ligado a la cuenta y se
reutiliza; se comprobó en dos arranques en este PC. [Dominio, aviso y cuotas de ngrok](https://ngrok.com/docs/pricing-limits/free-plan-limits).
Cloudflare cambia el hostname con cada nuevo túnel y su DNS puede tardar: el lanzador espera hasta tres minutos.
Las partidas de invitados se guardan por dirección de servidor en el navegador: un nuevo hostname no recupera
automáticamente el slot anterior, aunque el secreto sea estable. Para progreso ligado a identidad usa una cuenta.
El registro por correo exige autorizar la URL actual en Supabase Auth; para esta prueba el invitado evita ese paso.
Para un dominio propio configura un túnel con ese dominio. [Documentación de Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

## ¿Tu PC o el servidor?

- **La GPU no importa para el servidor.** El servidor solo corre la simulación (CPU: ~0.16 ms por paso a 60 Hz,
  casi nada). Cada jugador **dibuja el juego con la GPU de su propio equipo**, en su navegador. Hospedar en tu PC
  no le da tu GPU a tu amigo.
- Lo que cambia es la **red**:
  - **Servidor (VPS / «live box»)**, recomendado: siempre encendido, IP pública, sin tocar el router; los dos
    juegan con el ping al servidor. Para probar con un amigo es lo más simple y lo más justo.
  - **Tu PC**: tú tienes ping 0 y tu amigo el ping a tu casa. Necesitas abrir un puerto en el router o un túnel.
    Lo más rápido es un túnel de Cloudflare, que da una URL https al instante (los WebSockets pasan sin
    configurar nada):
    ```bash
    npm start                                       # en tu PC
    cloudflared tunnel --url http://localhost:5173  # imprime https://algo.trycloudflare.com → pásasela
    ```

## En el servidor (Ubuntu / Debian), paso a paso

```bash
# 1. Node 22 y git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs git
# 2. Un usuario para el juego y el código
sudo useradd -r -m -d /opt/marea-negra marea
sudo -u marea git clone https://github.com/joeyxd/realms-of-trade-server.git /opt/marea-negra
cd /opt/marea-negra && sudo -u marea git checkout claude/loving-lovelace-ptbif7 && sudo -u marea npm ci --omit=dev
# 3. Configuración (el secreto firma las partidas guardadas: generarlo una vez y no cambiarlo)
sudo cp deploy/marea-negra.env.example /etc/marea-negra.env && sudo chmod 600 /etc/marea-negra.env
sudo sed -i "s/^SAVE_SECRET=.*/SAVE_SECRET=$(openssl rand -hex 32)/" /etc/marea-negra.env
# 4. Servicio (arranca solo y se reinicia si cae)
sudo cp deploy/marea-negra.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl enable --now marea-negra
curl http://127.0.0.1:5173/status        # jugadores, tick, ms por paso
journalctl -u marea-negra -f             # registros
```

Para **entrar**, una de dos:

- **Sin dominio (lo más rápido)**: en `/etc/marea-negra.env` pon `HOST=0.0.0.0`, abre el puerto
  (`sudo ufw allow 5173/tcp`), `sudo systemctl restart marea-negra` y entrad los dos a `http://IP-DEL-SERVIDOR:5173`.
- **Con dominio y HTTPS** (mejor: algunos navegadores limitan páginas http): apunta un registro A a la IP, instala
  Caddy (`sudo apt-get install -y caddy`), copia `deploy/Caddyfile` a `/etc/caddy/Caddyfile` con tu dominio,
  `sudo systemctl reload caddy`, abre 80 y 443 y entrad a `https://tu-dominio`. Pon tu dominio en `ORIGINS`.

**Actualizar** a lo último de la rama: `sudo -u marea bash /opt/marea-negra/deploy/update.sh` (trae, instala,
reinicia y muestra `/status`). Las partidas guardadas viven en el navegador de cada jugador, firmadas con
`SAVE_SECRET`: sobreviven a los reinicios mientras el secreto sea el mismo.

## Variables

| Variable | Por defecto | Para qué |
|---|---|---|
| `PORT` / `HOST` | 5173 / 0.0.0.0 | Dónde escucha (`127.0.0.1` detrás de Caddy) |
| `MAX_PLAYERS` | 4 | Jugadores a la vez |
| `BOTS` | 3 | Bots en la isla (se apartan cuando entran jugadores) |
| `SAVE_SECRET` | aleatorio (aviso) | Firma las partidas guardadas |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | sin configurar | Adaptador durable; ambos juntos, clave de servicio privada |
| `SUPABASE_PUBLIC_KEY` | sin configurar | Activa cuentas; solo publishable o JWT anon, publicado en `/auth/config` |
| `WORLD_ID` | marea-negra | ID estable de la economía; una autoridad por ID, no cambiar entre reinicios |
| `WORLD_SAVE_SECONDS` | 60 | Intervalo de snapshot económico del entrypoint `npm start`; cierre guarda también |
| `ORIGINS` | (cualquiera) | Lista de orígenes permitidos para el socket del juego |
| `DEV` | 0 | `1` habilita F4 y el teletransporte de `?debug`: **nunca** en un servidor público |
| `LAG_MS` / `JITTER_MS` | 0 | Latencia artificial para pruebas |

## Cuentas y almacenamiento (M5 P1–P3)

El entrypoint carga el `.env` local de la raíz del repo si existe; las variables del proceso tienen prioridad.
Ese archivo y `.env.*` están ignorados por Git. Los nombres de este servidor son `SUPABASE_URL`,
`SUPABASE_PUBLIC_KEY` y `SUPABASE_SERVICE_KEY`; no utiliza el prefijo `NEXT_PUBLIC_` de Next.js.

P1 ya incluye `server/store.mjs` (memoria/Supabase) y `server/migrations/001_store.sql`, probados localmente.
`npm start` selecciona memoria sin `SUPABASE_URL`/`SUPABASE_SERVICE_KEY`; exige ambas si se configura una.
El par anterior sin `SUPABASE_PUBLIC_KEY` selecciona solo almacenamiento y deja cuentas desactivadas de forma
intencional. Añadir la clave pública activa el login del título y la verificación de `hello.token` con Auth.
Configuraciones parciales y claves públicas de tipo secret/service_role se rechazan al arrancar. Las cuentas
usan perfiles del servidor; un token inválido nunca entra como invitado. El Worker conserva sus partidas locales.

Antes de activar un proyecto real:

1. Aplicar `server/migrations/001_store.sql` y luego `002_accounts.sql` en ese proyecto. No se ejecutan automáticamente.
2. Configurar Auth con correo/contraseña y la URL real del juego para los correos de confirmación. Google/Discord
   y recuperación de contraseña aún no tienen UI propia. Mantener HTTPS y configurar `ORIGINS` para esa URL.
3. Conservar `SAVE_SECRET` original para importar partidas anteriores. La opción de importación es voluntaria y
   solo sirve antes de crear el primer personaje de la cuenta; una cuenta existente siempre prevalece, sin mezcla.
   Se exige firma válida e identidad `pirateId`. Partidas antiguas sin identidad se rechazan explícitamente.
4. Comprobar en el servicio real login, confirmación, perfil tras reiniciar, rechazo de acceso RLS/RPC con clave
   pública, duplicados y fallo del proveedor. `/status.storage.accounts` indica activación, no acredita esas pruebas.

La importación registra una identidad legacy única en la misma transacción que crea el perfil. Todas las versiones
firmadas de ese pirata quedan retiradas del flujo invitado del servidor con cuentas activas. La reserva de invitados
y cuentas cubre un solo proceso: no ejecutar varios hosts hasta implementar leases P5. P3 carga el mundo
antes de abrir el listener y guarda snapshots CAS aislados cada 60 s y al cerrar. Reloj, RNG, mercados y solares
se restauran con la misma semilla; registro ausente se crea antes de aceptar jugadores. Error de carga,
formato o semilla incompatible impide arrancar sin sobrescribir. Error/conflicto de escritura detiene ticks
y admisiones, devuelve `/health` 503 y el cierre informa fallo. Reiniciar solo después de resolver la causa.
`/status.storage.world` expone readiness, generación y errores fijos. No hay nueva migración para P3.

D09a añade `server/migrations/003_pearl_operations.sql`, después de 001/002. El autor confirmó que aplicó
las tres; D09b verificó RPC/RLS y operaciones SDK reales con fixtures temporales limpiados. Ningún comando
del juego usa todavía esa RPC. Crea recibos
idempotentes y protege los UIDs gestionados al guardar/importar perfiles; no adopta las perlas raras existentes.
No requiere nuevas variables ni reiniciar el host para completar este corte de almacenamiento. Antes de conectar
el juego, cerrar adopción/backfill y conectar staging/ack y suelo durable; verificar además solapamiento de
conexiones PostgreSQL independientes. D09b reserva cuentas/UID frente a autosaves y valida UIDs registrados
antes de WELCOME. Tras dos respuestas ambiguas sin recibo, las reservas permanecen incluso después de close;
`ProfileSessions.reconcilePearl(operationId)` solo lee recibo/perfiles/UID. No hay reintento mutante ilimitado,
endpoint público de recuperación ni lease entre procesos. [Resultado y límites D09b](delivery/d09b-pearl-sessions.md).

D09c añade **[004_pearl_ground.sql](../server/migrations/004_pearl_ground.sql)**: nueva, después de 001/002/003;
el autor la aplicó y D09d verificó RPC/RLS/SDK con fixtures aislados limpiados. Guarda posición/tiempos
de suelo, ledger, perfiles y recibos en una transacción; todas las tablas/RPCs quedan solo para el servicio.
No requiere variables nuevas y aplicarla no activa comandos del juego ni exige reiniciar el host.
Reaplicarla conserva filas/recibos. D09d conecta `ProfileSessions.commitPearlGround` y
`reconcilePearlGround` a reservas comunes; recuperación verifica perfil/UID/ubicación actual sin reenviar.
No requiere SQL adicional. Antes de activar circulación, completar diario durable de UUIDs/intenciones,
restauración/staging y política de adopción. Las reservas/contexto siguen en memoria del proceso.
[Resultado D09c](delivery/d09c-pearl-ground.md), [verificación y límites D09d](delivery/d09d-pearl-ground-queue.md).

El mundo guarda un sobre `{v:1, seed, economy}`; la economía usa formato v2 con RNG. El formato previo v1
sin RNG no se acepta silenciosamente como mundo persistente. El tiempo apagado no se simula. Mantenimiento
solo cobra a perfiles conectados; guardados de perfil/mundo aún son independientes, sin atomicidad P6.
El ledger de perlas, leases y movimientos durables P4–P6 siguen pendientes. [Evidencia D07d](delivery/d07d-world.md).

Las migraciones ya se aplicaron al proyecto local configurado por el autor. Un canario aislado comprobó
confirmación Auth, login por contraseña, permisos y perfil tras reiniciar; entrega de correo y despliegue
siguen pendientes. El registro/reenvío solicitan `emailRedirectTo` con el HTTP base del juego: añadir esa URL
en Auth → URL Configuration (desarrollo: `http://localhost:5173/`; producción: la URL HTTPS del juego).
El selector cambia nombre/aspecto de esta partida; todavía no sincroniza esos ajustes entre dispositivos.
Evidencia: [D07c UI y canario real](delivery/d07c-comic-account.md). Contrato previo y límites:
[D07a almacenamiento](delivery/d07a-store.md), [D07b cuentas](delivery/d07b-accounts.md).

Para el mundo persistente de M5 (personajes,
inventario, perlas únicas, economía, barcos), la propuesta es **Supabase**: Postgres con Auth (cuentas), Realtime
para chat y presencia (en lugar de Redis) y almacenamiento. El combate sigue en nuestros procesos Node. Solo el
servidor escribe en las tablas del juego, con la clave de servicio; el cliente solo lee lo público (reglas RLS).
Cuando haga falta un gateway y servidores por zona, irán en un repo o en una carpeta `services/` de este. Ver
`DESIGN.md` §16 y `docs/HANDOFF.md`.
