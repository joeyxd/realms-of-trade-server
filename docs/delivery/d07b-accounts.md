# D07b — M5 P2: cuentas e importación

Base inicial: `da757d3`, rama `claude/loving-lovelace-ptbif7`, continuación de P1 `208ff49` y PR #1.
Integración revisada sobre `a01294c`, que incluye M6 P1: versión `0.6.0-alpha.1`, protocolo **13**.
Estado: implementación y recorrido visual aceptados localmente; aceptación del servicio real pendiente.
P2 no cambia la simulación ni los snapshots. HELLO añade campos opcionales compatibles con invitados de
la misma versión: `token` e `importSave`. No hay push, despliegue ni publicación de artefacto de P2.

## Resultado y contrato

- El título en línea ofrece correo/contraseña, registro, aviso de confirmación, sesión persistida/renovada por
  el SDK oficial y cierre de sesión local. Google/Discord y recuperación de contraseña quedan pendientes.
- `server/auth.mjs` crea un cliente Auth separado, con clave pública y sin sesión persistida; verifica cada
  HELLO mediante `auth.getUser(token)`. La clave de servicio permanece en el cliente de almacenamiento. No se
  decodifica un token del navegador como prueba de identidad ni se aceptan sus campos `playerId`/`profile`.
- Ausencia de token significa invitado. Un token presente vacío, malformado, demasiado largo, inválido,
  perteneciente a un usuario Auth anónimo o rechazado por el proveedor produce `auth`, sin fallback.
  Logs/respuestas usan códigos fijos y no propagan detalles de errores del proveedor.
- `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` conservan intencionalmente selección de adaptador sin cuentas,
  compatible con P1. Añadir `SUPABASE_PUBLIC_KEY` habilita cuentas; exige configuración completa y clave
  publishable o JWT anon. Se rechazan claves secret/service_role y la misma clave privada como pública.
- `/auth/config` sirve solo `{enabled,url,publicKey}` con `no-store`. `/auth/sdk.js` sirve el UMD de la
  dependencia instalada y fijada por el lockfile; no se abre `node_modules` al cliente. No se incrustan claves
  en HTML, settings, artefactos o código. `npm start` conecta verificador, almacenamiento e inicialización.
- El Worker mantiene su flujo solo y no presenta el panel de cuentas. Un invitado conocido no necesita
  login. Un fallo de configuración/SDK desconocido exige elegir «Jugar como invitado»; perder una sesión
  de cuenta falla de forma visible. Elegir invitado para la página no borra la sesión guardada del proveedor.
- El token se obtiene al pulsar JUGAR y se envía solo por HELLO. Los listeners se registran antes de enviarlo;
  la UI se bloquea mientras entra y distingue versión, Auth, cuenta ocupada, almacenamiento e importación.
  Los timeouts de configuración empiezan tras compilar shaders. Una respuesta de inicialización nula no
  admite un perfil vacío. Las cuentas conservan P1: carga antes de WELCOME, escrituras CAS y guardado al cerrar.

## Importación voluntaria, una sola vez

Antes de crear el primer personaje de una cuenta se puede seleccionar la partida online anterior. Se valida
su HMAC con el `SAVE_SECRET` existente y se sanea. Se exige un `pirateId` no vacío y no reservado para cuenta;
las partidas antiguas sin identidad o con firma inválida se rechazan explícitamente. No se importan partidas
solo ni se mezclan perfiles. Crear una cuenta Auth por sí solo no crea un personaje; entrar al juego sí.

`initializeProfile(playerId, data, legacyKey=null)` crea y devuelve `{data,version:1}` si falta la cuenta.
Si ya tiene perfil, devuelve ese registro sin sobrescribirlo ni consumir otro recibo. `legacyClaimed(key)`
consulta el recibo. Los adaptadores memoria/Supabase comparten contrato y rechazos.

El servidor calcula SHA-256 de `marea-legacy-v1:` + identidad firmada; no confía en un hash enviado por el
cliente. Todas las versiones de una partida comparten ese recibo, aunque cambie el blob. El perfil de cuenta
usa `account:<UUID>` como identidad estable. `002_accounts.sql` crea `mn_legacy_imports` con clave global
única y FK al perfil; `mn_initialize_profile` inserta perfil y recibo en una transacción, con advisory locks
en orden cuenta → legacy. Un recibo usado por otra cuenta produce SQLSTATE `MNL01` → `legacy_used`, sin perfil
huérfano. Tablas/RPCs tienen RLS y permisos solo de servicio, igual que P1.

El mismo host reserva identidades legacy pendientes y activas antes de esperar a la DB. Importar mientras
el invitado sigue abierto produce `legacy_active`. Un legacy importado deja de restaurarse como invitado
en el servidor con cuentas activas. Una consulta pendiente sigue reservada hasta terminar aunque se cierre
o venza el socket, y libera sin admitir un jugador tardío. Los recibos durables sobreviven al reinicio de la
base; las reservas activas son de un proceso, **no leases entre hosts**.

## Evidencia local

- Regresión inicial: **313/313 sin `net.test.mjs` + 2/2 de red = 315/315**. Tras integrar M6 P1:
  **321/321 + 2/2 red = 323/323**, logs `shots/review/m5-p2-tests-current.log` y `m5-p2-net-current.log`.
  Concurrencia 2; red por separado. Los logs originales `m5-p2-tests.log`/`m5-p2-net.log` conservan el corte inicial.
- Tres suites nuevas: Auth cliente, store/importación y servidor de cuentas. Cubren respuesta HTTP real del
  SDK `getUser`, token ausente/inválido, identidad falsa, errores redactados, carga antes de WELCOME,
  firma/identidad inválida, cuenta existente, versiones legacy, retiro de invitado, carrera invitado/importación,
  timeout de consulta y rechazo de inicialización nula. Contrato Auth final: **7/7**, `m5-p2-client.log`.
- PGlite ejecuta migraciones 001 y 002, con el SDK Supabase sobre transporte local: RPC real SQL, reaplicación,
  duplicados sin filas huérfanas y permisos denegados a anon/authenticated en recibos/RPCs. Una conexión embebida
  **no acredita bloqueo entre conexiones independientes ni el PostgREST de un proyecto real**.
- CLI real, procesos separados con valores falsos/locales: sin configuración → memoria/cuentas false;
  par de almacenamiento → Supabase/cuentas false; trio → Supabase/cuentas true. Configuración parcial y
  clave pública privada rechazadas sin exposición. `shots/review/m5-p2-cli.log`; no hubo llamadas remotas.
- `tools/account-review.mjs` usa Chrome, SDK instalado, HTTP Auth **simulado localmente**, servidor real de
  juego y WebSocket. Capturas/resultado en `shots/review/m5-accounts/`; recorrido final sobre M6 P1 en
  `m5-p2-browser-current.log`, con escritorio y móvil aprobados y cero errores JS de página.
  Escritorio 1280×720: contraseña inválida, registro/aviso, login, importación opt-in, rechazo de token,
  importación de oro 57 y restauración de cuenta tras recargar. Móvil emulado 844×390: login, cierre local,
  límites del diálogo y rechazo de la partida invitada retirada. No se enviaron correos reales.
- Layout del título ajustado tras inspección: acceso Cuenta en la fila de conexión, margen del logo explícito,
  límite del card, campo de nombre más compacto y controles de poca altura. Las contraseñas se vacían al
  enviar/cerrar; el diálogo captura Escape/Enter/Tab y usa texto para los mensajes del proveedor.
  Se separó JUGAR del tween de entrada para que el pulso no conserve un desplazamiento de 20 px. Revisión
  móvil final en `m5-p2-mobile.log`/`mobile-results.json`: aviso de importación debajo del botón, sin solape.
- Sintaxis de archivos modificados y `git diff --check` limpios. No se añadieron dependencias; el SDK viene
  del lockfile de P1. Las capturas usan SwiftShader y escena congelada para revisar UI; no miden FPS/GPU,
  teclado virtual, teléfono o mando físicos. Fuentes Google bloqueadas y fallbacks de tipografía presentes.

Referencias primarias revisadas: [verificar usuario](https://supabase.com/docs/reference/javascript/auth-getuser),
[acceso por contraseña](https://supabase.com/docs/reference/javascript/auth-signinwithpassword),
[claves públicas/privadas](https://supabase.com/docs/guides/getting-started/api-keys).

## Configuración del proyecto real

El autor configuró URL, clave pública y servicio en el `.env` local ignorado por Git. El entrypoint lo carga,
con prioridad para variables del proceso; no se registraron las claves en código, documentación ni evidencia.
La configuración habilita cuentas y selecciona Supabase. Consultas de solo lectura al proyecto real:

- Auth settings: HTTP 200, correo habilitado, registro permitido y confirmación de correo requerida.
- Clave de servicio del tipo esperado y esquema REST: HTTP 200; `mn_initialize_profile` no aparece publicado.
- Las cuatro tablas `mn_*`: HTTP 404 / `PGRST205`; los RPCs de lectura: HTTP 404 / `PGRST202`.
  No están disponibles en el esquema API actual. El rechazo público antes de crearlos no prueba sus permisos.

Evidencia: `shots/review/m5-p2-public-probe.log` y `m5-p2-service-probe.log`, solo estados y códigos fijos,
sin claves ni datos de jugadores. No hubo escrituras remotas, registro ni correo real. Se prepararon 001 y 002
juntas en `.scratch/m5-supabase-setup.sql` para ejecutar en SQL Editor; falta verificar tras su aplicación.

## Pendientes y siguiente corte

Aceptar un proyecto Supabase real: migraciones, RLS/RPC con clave pública, Auth/confirmación, perfil tras
reiniciar el servidor, fallos de DB/proveedor y concurrencia real. Configurar URL de confirmación, HTTPS,
orígenes y respaldo con el operador. Las credenciales ya están configuradas; las migraciones del proyecto
real y su aceptación siguen pendientes.

**Siguiente trabajo M5: P3**, cargar economía al arrancar, autosave de mundo y guardado final con versiones
CAS. P4/P6 deben conectar perfiles, suelo/ledger y transferencias durables antes de bienes en riesgo; P5 debe
resolver leases antes de varios hosts. Afinidad, legendarias, pérdidas navales y decisiones del autor quedan
fuera de este corte. D04 conserva su preparación para balsa/cubierta cuando el autor retome esa entrega.
