# D07d — economía del mundo persistente (M5 P3)

Base de misión `f0b74a7`; durante el trabajo se integraron los commits ajenos de materiales de balsa
`fa07148` y `7e64007`. Versión `0.6.0-alpha.1` y protocolo 13 conservados. Entrega local; sin push ni
despliegue. Dueños/rutas: [brief](../briefs/m5-p3-world.md).

## Resultado y contrato

- `server/worldState.mjs`: el host carga el mundo antes de abrir HTTP/WebSocket o iniciar ticks. Un ID ausente
  se crea mediante CAS de versión cero antes de admitir jugadores. Carga fallida/formato incompatible/semilla
  distinta impiden arrancar; nunca sustituyen el registro por valores iniciales.
- Cada 60 s y al cerrar se captura un snapshot aislado del mundo. Una sola escritura activa, coalescing al
  estado más reciente, generaciones CAS consecutivas y flush esperado al cerrar. La base no entra al pump.
- Economía v2: reloj, acumulador, estado exacto del RNG, mercados con stock/tendencia y solares con dueño,
  construcción, recetas, almacén y deuda. Hora cero válida. `Economy.from` conserva compatibilidad general
  con v1, pero la frontera persistente exige v2: v1 no puede recuperar el estado del RNG perdido.
- Restauración conserva el callback de mantenimiento del host; no usa el default que concede pago gratis.
  Los datos se desacoplan/sanean; un solar no puede reemplazar su town/índice ni introducir campos arbitrarios.
- Error de escritura o conflicto, incluso respuesta perdida después de commit, detiene ticks/admisiones y
  cierra sockets con motivo fijo `storage`. `/health` pasa a 503 y el cierre informa fallo. No hay reintento
  que recargue otra versión para sobrescribirla. `/status.storage.world` expone readiness/generación/errores,
  sin datos privados ni mensajes del proveedor.
- `WORLD_ID=marea-negra` debe conservarse entre reinicios. `WORLD_SAVE_SECONDS=60` permite ajustar el
  intervalo en el entrypoint `npm start`. API `createGameServer` acepta `worldId`/`worldSaveMs`; `GameHost`
  directo conserva `worldId:null` por defecto para consumidores que no usan persistencia de mundo.

Memoria usa el mismo contrato pero no sobrevive al proceso. Supabase usa `mn_load_world`/`mn_save_world` de
la migración 001 ya aplicada; no hace falta otra SQL. El sobre persistido es `{v:1, seed, economy}`.

## Evidencia real

Canario con un ID temporal nuevo en el Supabase configurado por el autor, sin consultar partidas existentes:

1. Creación confirmada antes de readiness/HTTP 200.
2. Snapshot de cierre guardado con reloj cero, acumulador, stock/tendencia y solar con receta/almacén/deuda.
3. Segundo host restaura exactamente ese snapshot.
4. Siguiente paso económico coincide con la continuación determinista del snapshot.
5. Otro escritor gana CAS; el host atrasado queda detenido con health 503, rechaza flush/cierre y conserva
   intacto el registro más reciente de la base.
6. Fixture eliminado y ausencia verificada al cerrar.

Log redactado: `shots/review/m5-p3-live.log`. No se mostraron claves ni mensajes del proveedor, ni se crearon
cuentas. Esta misión no reinició ni apagó el servidor/host del PC. El dueño del trabajo de PC lo arrancó
durante el trabajo compartido; `/status` ya informa Supabase durable, mundo ready/sin fallo, versión 11,
cero errores de almacenamiento y cero errores de simulación. Es un checkpoint live, no una generación fija.

## Pruebas locales y límites

**79/79 pruebas pertinentes**, sin ampliar la afirmación a toda la suite del checkout compartido:

- Cuentas, importación y store/SQL: **43/43**, `shots/review/m5-p3-regression.log`.
- Aceptación consolidada del principal: **34/34** = 15 nuevas de mundo/host + 19 de economía,
  `shots/review/m5-p3-acceptance.log`. Arranque gateado, autosave real con write lento/coalescing, snapshot
  final, callback de upkeep, cancelación de carga, close antes de listen, datos incompatibles y commit con
  respuesta perdida cubiertos. El worker también obtuvo 15/15 en `m5-p3-world-tests.log`.
- Red con dos jugadores/latencia: **2/2**, `shots/review/m5-p3-net.log`.

Sintaxis y diff limpios al integrar. Revisión de contrato Luna en solo lectura y aceptación del principal.
No hay cambio visual ni recorrido de navegador adicional en este corte. El host activo también fue consultado
en loopback; el resultado redactado se guarda en `shots/review/m5-p3-active-host.log`.

Una autoridad por ID; CAS detecta escrituras atrasadas, no concede leases antes de ejecutar operaciones en
dos procesos. P5 debe resolver esa exclusión. Snapshots de perfil y mundo siguen siendo independientes:
P6 debe dar atomicidad/recibos antes de riesgo económico persistente. Un cierre de proceso abrupto puede perder
lo posterior al último snapshot; esto es autosave/cierre ordenado, no un log transaccional de cada acción.
El reloj no avanza durante downtime. Mantenimiento cobra solo a perfiles conectados; cobro offline pendiente.
P3 no guarda ECS, balas, jefes, sesión de combate ni ubicaciones operativas de nuevas naves.

Trabajo ajeno de balsas/assets/host del PC preservado y commits selectivos. Próximo corte M5: preparar P4
con el contrato duradero de perlas/perfiles y P6 para sus transferencias; no activar legendarias o saqueo
persistente sin resolverlo. Correo humano, publicación y dispositivos físicos conservan sus pendientes.
