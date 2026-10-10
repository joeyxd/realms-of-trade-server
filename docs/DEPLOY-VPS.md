# Despliegue alfa en el VPS compartido

Esta guía instala MAREA NEGRA como una aplicación Compose independiente en el VPS que ya usa Docker, Coolify y Traefik. El host no necesita Node.js. El contenedor es la única autoridad de este mundo: no levantes el lanzador del PC ni otra réplica con `WORLD_ID=marea-negra` al mismo tiempo.

El objetivo de esta primera entrega es el commit `5fa9658b5f2265bd1ea8c58b3e59722fcbe4603d` (versión `0.6.0-alpha.16`) y la imagen local `marea-negra:alpha-5fa9658`. La URL provisional es <https://marea.62.171.136.148.sslip.io>. Coolify conserva la red externa `coolify`; Traefik enruta los entrypoints `http` y `https`, redirige HTTP a HTTPS y obtiene TLS con el resolver `letsencrypt`.

## Actualizaciones continuas y recuperación

El autor pidió mantener este mismo deploy actualizado. El servicio `marea-negra-update.timer` revisa cada
dos minutos los pushes a `claude/loving-lovelace-ptbif7`. Solo usa archivos del commit remoto: cambios sin
commit del checkout compartido no se publican. El script [vps-update.py](../deploy/vps-update.py) construye
la imagen y ejecuta regresiones sin credenciales ni conexión de base de datos antes de detener el servidor.
Si hay jugadores o estado pendiente, espera al siguiente ciclo. Detiene la autoridad anterior antes de
arrancar la nueva, comprueba revisión/salud/almacenamiento y vuelve a la imagen anterior si falla.
Conserva `/etc/marea-negra/alpha.env`, `SAVE_SECRET` y `WORLD_ID`; no ejecuta migraciones ni activa M5/Web3.
Cambios que requieren SQL o configuración necesitan su integración específica antes de publicarse.

La descarga usa historial acotado y trae solo los blobs de las rutas que necesita la release. Antes de
construir, comprueba CPU ocupada, espera de disco, memoria disponible y espacio libre del VPS compartido.

El enlace `/opt/marea-negra/current` identifica la release aceptada. El código del actualizador instalado
en `/opt/marea-negra/ops/vps-update.py` no se sustituye a sí mismo desde Git. Para actualizar el propio
actualizador, revisar/copiar su nueva versión y unidades; el runtime sí se actualiza en cada imagen.

```bash
systemctl status marea-negra-update.timer --no-pager
journalctl -u marea-negra-update.service -n 30 --no-pager
python3 /opt/marea-negra/ops/vps-update.py --check
readlink -f /opt/marea-negra/current
```

`--check` consulta revisiones sin construir ni reiniciar. Para publicar inmediatamente un push terminado,
ejecutar `systemctl start marea-negra-update.service`; respeta el mismo bloqueo y espera si hay jugadores.
Para mantenimiento manual, detener primero el timer y esperar que el servicio termine; reactivarlo al
cerrar. No levantar otra réplica. El cierre requiere unos segundos y los clientes deben recargar al cambiar
el protocolo. Una revisión rechazada conserva la release anterior y queda registrada con espera entre intentos.

La incidencia del 9 de octubre dejó el contenedor vivo pero con el mundo bloqueado tras un error de guardado.
Docker no reinicia un proceso únicamente por estar `unhealthy`. El [runtime](../deploy/runtime.mjs) ahora
supervisa al proceso del juego y solicita cierre ordenado tras cuatro comprobaciones consecutivas de ese
fallo concreto, sin jugadores/perfiles pendientes y sin coordinadores opcionales activos. Docker reinicia
el contenedor y el juego vuelve a cargar la base de datos. No elimina el bloqueo de seguridad ni reenvía
un guardado ambiguo. Estados desconocidos, perfiles pendientes o M5 opcional activo requieren diagnóstico;
este supervisor no acredita recuperación completa de todas las acciones.

El paquete Compose usa un contenedor, un máximo de cuatro jugadores y un techo de 3 CPU compartidas,
sin afinidad ni núcleos exclusivos: consume CPU según la demanda, hasta ese límite. Mantiene 1 GiB de
memoria y swap combinados, heap Node limitado a 640 MiB y la reserva declarativa de 0,25 CPU/256 MiB.
El actualizador y sus pruebas conservan su presupuesto separado de una CPU. Ampliar el techo no
paraleliza por sí solo la simulación JavaScript ni acredita mayor capacidad de jugadores.
Usa Node 22, usuario sin privilegios, filesystem de solo lectura, `/tmp` temporal, cierre con 90 segundos
de gracia y no publica puertos en el host. Las etiquetas de Traefik son exclusivas de `mn-alpha`;
el juego no requiere modificar el proxy compartido.

El techo del contenedor activo puede aumentarse sin reiniciar con `docker update --cpus 3 <container>`.
Debe coincidir con ambos límites de `deploy/compose.vps.yml` para conservarlo al recrear una release.
Una vuelta a una release anterior conserva el límite de su manifiesto; comprobarlo tras un rollback.

## Estado y alcance comprobado

La sonda corta de cuatro clientes pasó: 4/4 admitidos, 6.888 comandos de movimiento, 2.449 snapshots posteriores a la admisión, cero errores y desconexiones inesperadas, y 4/4 respuestas de chat. El tiempo de paso muestreado fue mediana 2,525 ms, p95 3,271 ms y máximo 3,436 ms. En esa ejecución, el contenedor usó en promedio 26,09 % de un núcleo, llegó a 46,29 % y ocupó entre 57,31 y 64,52 MiB. Es una prueba breve de cuatro clientes; no demuestra estabilidad prolongada, capacidad MMO, disponibilidad móvil ni margen ante abuso.

El canario de cuenta real confirmó login, recolección normal de madera y piedra, fabricación de un hacha y guardado Supabase de perfil v6. Después de detener y arrancar el contenedor real, la misma cuenta recuperó el hacha y la mochila sin cambios. El cierre terminó con código 0, sin OOM; el host restauró el checkpoint económico v385. La cuenta y el perfil temporales fueron eliminados. Esta prueba acredita ese flujo y un reinicio ordenado; no acredita atomicidad de todas las acciones ni recuperación tras una caída abrupta. La evidencia sin credenciales vive en [delivery/vps-alpha](delivery/vps-alpha/).

La configuración de producción para cuentas requiere el conjunto de tres valores: `SUPABASE_URL` y `SUPABASE_SERVICE_KEY` seleccionan el almacenamiento Supabase durable; `SUPABASE_PUBLIC_KEY` (publishable o anon) habilita login y verificación de cuentas. Sin el primer par, el juego cae en almacenamiento en memoria; el par sin clave pública deja el almacenamiento durable activo, pero las cuentas desactivadas. `/status.storage.kind`, `.durable` y `.accounts` permiten comprobar el modo real. Las cuentas guardan perfiles con control de versión CAS. El mundo económico usa snapshots cada 60 segundos (`WORLD_SAVE_SECONDS=60`) y guarda también al cerrar. Confirma que `001_store.sql` y `002_accounts.sql` ya estén aplicadas antes de admitir jugadores; esta guía no ejecuta SQL ni activa integraciones nuevas.

Los invitados conservan su partida en el navegador mediante una firma HMAC; `SAVE_SECRET` debe mantenerse idéntico entre despliegues. El agotamiento de nodos de recursos no persiste tras reinicios. Las perlas/objetos del suelo no tienen persistencia de juego activada, y el harness de contribución A1a sigue sin montarse en el host. No prometas que estos estados sobreviven a un reinicio.

## Crear una release reproducible

Ejecuta el empaquetado desde un equipo con el repositorio y SSH configurados. Runtime, pruebas y empaquetado proceden del mismo commit fijado. Así no se envían cambios dirty, `.env`, `.git`, documentación o materiales al VPS ni a la imagen. Sustituye `usuario-ssh` por la cuenta SSH ya autorizada para el host.

```bash
commit=$(git rev-parse HEAD)
host=usuario-ssh@62.171.136.148 # sustituye usuario-ssh por la cuenta autorizada
release=/opt/marea-negra/releases/$commit

git archive --format=tar -o /tmp/marea-negra-$commit.tar "$commit" \
  package.json package-lock.json index.html server src styles assets .dockerignore deploy tests
sha256sum /tmp/marea-negra-$commit.tar
ssh "$host" "test ! -e '$release' && mkdir -p '$release/deploy'"
scp /tmp/marea-negra-$commit.tar "$host:/tmp/marea-negra-$commit.tar"
ssh "$host" "sha256sum /tmp/marea-negra-$commit.tar"
```

Compara las dos sumas SHA-256 antes de extraer. Si difieren, elimina únicamente el archivo temporal de transferencia y repite; no uses una release parcial. Si el directorio de release ya existía, detente y verifica su contenido en vez de sobrescribirlo. Con sumas iguales, extrae el archivo; el empaquetado procede del mismo commit:

```bash
ssh "$host" "tar -xf /tmp/marea-negra-$commit.tar -C '$release' && rm /tmp/marea-negra-$commit.tar"
```

Comprueba que el directorio solo contiene archivos del commit. El build ignora las pruebas y el actualizador:
incluye el runtime del juego y `deploy/runtime.mjs`. Instala dependencias con `npm ci --omit=dev`; el cliente
carga Three.js por el import map del navegador. Los ejemplos de imagen/release `5fa9658` debajo documentan
la primera instalación; al preparar otra, usar su SHA/tag/versión propios. El actualizador hace esto automáticamente.

En el VPS, confirma que la infraestructura compartida existe sin modificarla:

```bash
docker version --format '{{.Server.Version}}'
docker compose version
docker network inspect coolify --format '{{.Name}}'
```

La referencia de esta release es Docker 27 y Compose 2.38. Si faltan la red `coolify`, los entrypoints `http`/`https` o el resolver `letsencrypt`, no crees recursos paralelos ni cambies Traefik desde esta guía: resuelve primero la configuración compartida con el operador del host.

## Configurar los archivos privados

Crea `/etc/marea-negra` con modo `0700` y `alpha.env` con modo `0600`. El archivo privado ya está instalado en el host: primero revisa permisos y conserva su contenido y `SAVE_SECRET`. Solo crea archivos si faltan; nunca inicialices encima de uno existente.

```bash
sudo stat -c '%a %U:%G %n' /etc/marea-negra /etc/marea-negra/alpha.env
if ! sudo test -d /etc/marea-negra; then sudo install -d -o root -g root -m 0700 /etc/marea-negra; fi
if ! sudo test -e /etc/marea-negra/alpha.env; then sudo install -o root -g root -m 0600 /dev/null /etc/marea-negra/alpha.env; fi
sudoedit /etc/marea-negra/alpha.env
```

Incluye al menos estos valores estables:

```dotenv
BOTS=3
WORLD_ID=marea-negra
WORLD_SAVE_SECONDS=60
SAVE_SECRET=<secreto aleatorio generado una vez y conservado>
MN_WEB3_WALLET_ENABLED=0
```

El `SAVE_SECRET` es secreto de servidor. Consérvalo de forma segura y no lo pegues en comandos, logs, release.env, Git, argumentos de build ni etiquetas de imagen. Conserva también el `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` privado y `SUPABASE_PUBLIC_KEY` existentes, sin imprimirlos. La clave de servicio nunca se configura en el cliente. Sin el par URL/clave de servicio, `/status` debe mostrar almacenamiento `memory` y `durable=false`; no anuncies persistencia de perfiles ni economía como durable.

Guarda solo valores no secretos para Compose en `deploy/release.env` y deja el archivo legible para el operador:

```dotenv
GAME_IMAGE=marea-negra:alpha-5fa9658
GAME_HOSTNAME=marea.62.171.136.148.sslip.io
WORLD_ID=marea-negra
MN_ENV_FILE=/etc/marea-negra/alpha.env
GIT_COMMIT=5fa9658b5f2265bd1ea8c58b3e59722fcbe4603d
APP_VERSION=0.6.0-alpha.16
```

Protege el archivo con modo `0600`; aunque solo contiene valores de Compose, no agregues tokens ni claves:

```bash
chmod 0600 deploy/release.env
```

El `WORLD_ID` de ambos archivos debe seguir siendo `marea-negra`. Compose fija `PORT=5173`, `HOST=0.0.0.0`, `MAX_PLAYERS=4`, `DEV=0` y `ORIGINS=https://marea.62.171.136.148.sslip.io`. No cambies esos límites ni el origen para exponer el socket directamente.

## Construir y arrancar

Los siguientes comandos se ejecutan dentro de `/opt/marea-negra/releases/5fa9658b5f2265bd1ea8c58b3e59722fcbe4603d`. El build corre dentro de Docker; no instales Node en el host.

```bash
cd /opt/marea-negra/releases/5fa9658b5f2265bd1ea8c58b3e59722fcbe4603d
docker build \
  --build-arg GIT_COMMIT=5fa9658b5f2265bd1ea8c58b3e59722fcbe4603d \
  --build-arg APP_VERSION=0.6.0-alpha.16 \
  -t marea-negra:alpha-5fa9658 \
  -f deploy/Dockerfile .
```

Revisa que la etiqueta de revisión de la imagen coincide con el SHA completo, sin mostrar variables del contenedor:

```bash
docker image inspect marea-negra:alpha-5fa9658 \
  --format '{{.Id}} {{index .Config.Labels "org.opencontainers.image.revision"}}'
```

Arranca con nombre de proyecto fijo. `--no-build` obliga a usar la imagen identificada que acabas de construir; el único archivo que contiene secretos se monta como entorno de runtime.

```bash
docker compose --project-name marea-negra-alpha \
  --env-file deploy/release.env \
  -f deploy/compose.vps.yml up -d --no-build
```

Confirma que hay exactamente un contenedor y que el healthcheck está sano:

```bash
docker compose --project-name marea-negra-alpha \
  --env-file deploy/release.env -f deploy/compose.vps.yml ps
cid=$(docker compose --project-name marea-negra-alpha \
  --env-file deploy/release.env -f deploy/compose.vps.yml ps -q marea-negra-alpha)
docker inspect "$cid" --format '{{.Config.Image}} {{.State.Health.Status}} {{index .Config.Labels "org.opencontainers.image.revision"}}'
```

Revisa `/health` y el estado público. `/status` incluye nombres de jugadores y datos de red; filtra esos campos antes de guardar o compartir la salida:

```bash
curl -fsS https://marea.62.171.136.148.sslip.io/health
curl -fsS https://marea.62.171.136.148.sslip.io/status | jq '{game,version,players,max,sockets,tick,uptime,stepMs,errors,storage:(.storage|{kind,durable,accounts,errors,unsaved,tickBlocked,worldReady:.world.ready,worldGeneration:.world.generation})}'
```

Verifica que `players` empieza en cero, `errors` y `storage.errors` sean cero, y que `tick` avance en una segunda lectura. Para confirmar TLS, abre la URL HTTPS y establece una sesión WebSocket; la dirección pública no expone el puerto 5173 del host.

La sonda opcional desde un equipo operador con Node 22 y `ws` instalado es `node tools/qa-vps-capacity.mjs wss://marea.62.171.136.148.sslip.io`. Abre cuatro invitados temporales y envía cuatro mensajes de prueba; úsala cuando el mundo esté libre de jugadores. No la confundas con la aceptación de cuenta real y recuperación de datos tras reinicio.

## Actualizar o volver atrás

Esta autoridad es de una sola instancia: no uses blue/green, dos réplicas ni una segunda copia de `WORLD_ID=marea-negra`. Para cada actualización, prepara un directorio nuevo con runtime y empaquetado del mismo commit exacto; crea un tag de imagen nuevo. No reemplaces el contenido de una release ya desplegada.

Antes de cambiar la imagen, detén el proyecto actual y deja que el proceso cierre/guarde durante su gracia de 90 segundos. Hay una interrupción breve mientras se cambia la única autoridad:

```bash
docker compose --project-name marea-negra-alpha \
  --env-file /opt/marea-negra/releases/<SHA_ACTUAL>/deploy/release.env \
  -f /opt/marea-negra/releases/<SHA_ACTUAL>/deploy/compose.vps.yml stop --timeout 90
```

En la nueva release, conserva `MN_ENV_FILE=/etc/marea-negra/alpha.env`, `WORLD_ID=marea-negra` y el hostname; cambia `GAME_IMAGE`, `GIT_COMMIT` y `APP_VERSION` para que correspondan a la imagen nueva. Después arranca el mismo proyecto usando su nuevo archivo Compose:

```bash
docker compose --project-name marea-negra-alpha \
  --env-file /opt/marea-negra/releases/<SHA_NUEVO>/deploy/release.env \
  -f /opt/marea-negra/releases/<SHA_NUEVO>/deploy/compose.vps.yml up -d --no-build
```

Para volver atrás, usa únicamente una imagen compatible con los datos ya adoptados. Después de activar
SQL015/recursos durables, conserva `MN_RESOURCE_OPERATIONS=1` y `MN_ECONOMIC_OPERATIONS=1`: una
imagen anterior al contrato de recursos no es un rollback válido para ese mundo. Ver el
[contrato y activación de recursos](briefs/m5-resource-authority.md).

Detén la autoridad por hasta 90 segundos y apunta `GAME_IMAGE` a la imagen compatible ya existente.
Conserva exactamente el mismo `alpha.env`, `SAVE_SECRET`, hostname y `WORLD_ID`. Arranca esa release
y repite las comprobaciones de salud y estado. Nunca la inicies antes de confirmar que la otra se detuvo.
