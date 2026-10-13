# CH01: personajes guardados independientes

2026-10-12, integrado el 2026-10-13 como alpha.70, protocolo 62. Requiere SQL038 listo antes de publicar.

## Integración 2026-10-13

La rama se unió con origin en alpha.69/protocolo 61, que ya traía L03g-a (presencia segura de
compañeros, SQL039). La presencia usaba `session.key` como dueño; con slots esa clave es el
personaje elegido, no la cuenta. `companionPresence` y el bloqueo de pairing pasan a
`sessionOwner(session)`, igual que configuración, control, creación, pairing e inferencia.
La prueba nueva de `player-character-owner-scope` falla sin ese cambio y pasa con él.
Las operaciones de perlas siguen ligadas al personaje: su perfil lleva `account:<personaje>`
(SQL038 lo impone), que es lo que comprueban give/swallow/leave.

Sobre el código unido: actualizador 197/197, slots/compañeros/cuentas 155/155 y Chrome repetido
en invitado y cuenta (77 → 0 → 77 monedas, blob anterior intacto, pistolas nuevas, 0 errores JS).
Capturas fuera de git (sha256): cuenta `54bcdceceb2d` escritorio, `5c99913cd47c` móvil,
`e33d7c7b3b4f` crear; invitado `413098f10fb3` escritorio, `3d0da947d748` móvil, `1b6380e131a8` crear.
SQL038 ya existe en producción: `mn_player_characters_ready` responde 42501 al rol anon, no PGRST202.

## Comportamiento

La cuenta tiene tres plazas. Continuar carga el perfil elegido; crear obtiene otro UUID, inventario,
equipo, poderes, economía y progreso. Un Bucanero nuevo empieza con pistolas. Su aspecto no sustituye
el arma equipada de una partida anterior.

El perfil histórico conserva UUID, JSON, versión, recibos y objetos únicos. El primer acceso pide
confirmar nombre/aspecto una vez porque el formato anterior no los guardaba. Registrar esa plaza
no reescribe el perfil. No se incluye borrar, clonar ni transferir personajes.

El servidor obtiene el propietario del token autenticado, valida `characterId` y aplica el nombre/aspecto
del roster. El UUID de personaje sigue siendo la autoridad de perfiles y operaciones M5. El UUID de
cuenta conserva permisos de compañeros, inferencia, GM y wallet. La exclusión de sesión por cuenta
permanece hasta terminar la escritura final. Invitados tienen plazas locales por navegador/servidor,
conservando el blob antiguo; la pantalla explica esa diferencia.

## Validación local

- SQL038 + adaptador en memoria: 10/10; preservación exacta del legado, pertenencia, límites,
  idempotencia, importación única, ACL y guard de perfiles. PGlite no sustituye la instalación Supabase.
- Host, permisos de propietario y cliente de slots: 17/17. Se guardan 61 monedas solo en el Bucanero;
  el legado mantiene 987; HELLO ajeno, invitado y agente no pueden tomar un personaje humano.
- Cuentas/auth/importación, starter, exclusión de perlas y sesiones: 75/75.
- Configuración/control/creación de compañeros e inferencia por WebSocket: 21/21.
- Integración final tras incorporar `9349d7c`: pairing cliente/red + slots host/owner/cliente,
  33/33. Se repitió sin navegador concurrente y desaparecieron los timeouts iniciales.
- Las suites anteriores se solapan con ejecuciones de integración; no sumar sus conteos como una suite general.

Comandos reproducibles:

```powershell
node --test --test-concurrency=1 tests/player-character-sql.test.mjs tests/player-character-store.test.mjs
node --test --test-concurrency=1 tests/player-character-host.test.mjs tests/player-character-owner-scope.test.mjs tests/player-characters-client.test.mjs
node --test --test-concurrency=1 tests/accounts-server.test.mjs tests/account-import.test.mjs tests/account-auth.test.mjs tests/profile-sessions-starter.test.mjs tests/pearl-mutation-gate.test.mjs tests/pearl-sessions.test.mjs
node --test --test-concurrency=1 tests/companion-config-network.test.mjs tests/companion-control-network.test.mjs tests/companion-creation-network.test.mjs tests/inference-config-network.test.mjs
```

El recorrido de Chrome usa la portada y formularios reales: conservar Espadachín con 77 monedas,
crear Bucanero con pistolas y cero monedas, volver al anterior con 77. El blob local original permanece
idéntico. Escritorio 1280×800 y móvil 390×844; capturas inspeccionadas, sin errores JS.
El modo cuenta sustituye solo el proveedor Auth por una identidad de prueba; HTTP, WSS, perfiles y
simulación son reales, con almacenamiento aislado en memoria. Se pausa WebGL durante los formularios
para no saturar SwiftShader. Las fuentes CDN se omiten en la captura; no es una prueba de FPS físico.

Recibos: [invitado](guest/receipt.json), [cuenta](account/receipt.json).
Capturas inspeccionadas: [escritorio cuenta](account/desktop-slots.png),
[móvil cuenta](account/mobile-slots.png), [crear en móvil](account/mobile-create.png),
[escritorio invitado](guest/desktop-slots.png), [móvil invitado](guest/mobile-slots.png),
[crear invitado](guest/mobile-create.png).

```powershell
$env:MN_PLAYWRIGHT='<ruta a playwright/index.mjs>'
$env:MN_GSAP='<ruta al paquete gsap 3.12.5>'
node tools/player-characters-review.mjs
node tools/player-characters-review.mjs --account
```

Dos fixtures de `save.test.mjs` esperan masa 18 donde el código entrega 28. Ambos fallan igual en una
exportación limpia del commit base `6f997ce`; no se modifica ese contrato ni se declara la suite general verde.
En la primera ejecución de pairing hubo timeouts bajo carga de navegador; el cierre inmediato del socket
también fallaba en el base. La integración incorpora el fix concurrente `9349d7c` y su espera de cierre.

## Instalación y publicación pendientes

1. Ejecutar [SQL038](../../../server/migrations/038_player_characters.sql) en Supabase. Es transaccional,
   no convierte ni reescribe perfiles existentes. Añade roster, selección, recibos de creación y RPC privadas,
   además del guard que impide perfiles fantasma desde inicializadores antiguos.
2. Verificar `select public.mn_player_characters_ready();` devuelve `{"version":1}` y las ACL de servicio.
3. Incorporar a la rama de continuidad/PR #1 y usar el actualizador normal, que espera mundo vacío.
   SQL no forma parte del actualizador; enviar antes dejaría indisponible la entrada de cuenta nueva.
4. Confirmar revisión/imagen activa, salud pública y `storage.playerCharacters.ready=true`; probar entrada,
   creación y reentrada autenticadas en alpha antes de aceptar persistencia pública.

No hubo SQL ni despliegue de esta entrega en producción. La sesión no dispone de editor Supabase ni
conexión SQL; SSH al VPS no proporciona una conexión de administración de base de datos.
