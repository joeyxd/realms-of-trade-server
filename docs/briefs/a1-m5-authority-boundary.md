# A1 / M5 — una autoridad para la partida persistente

2026-10-09. Revisión solicitada por el autor al detectar que otro agente lleva continuidad.
Base inspeccionada: `f0b696f`, más cambios locales concurrentes. Este documento delimita esta
línea de trabajo; no acredita despliegue ni sustituye la aceptación del dueño de M5.

## Decisión de esta línea

**M5 conserva la autoridad de persistencia de GameHost.** A1 no continúa con otro montaje de
sesiones, otro autosave ni otra mochila. Los controladores y migraciones comunitarios A1b1–A1b2b4
se conservan como banco aislado de contratos y regresión; no son una segunda ruta de producción.
No aplicar sus SQL ni copiar perfiles M5 allí para habilitar aportes.

La auditoría sí encontró solapamiento: `ProfileSessions` y `BoundProfileSessions` resuelven
admisión, reservas, versiones, incertidumbre y recuperación. El corte A1b2b4 no está montado en
`server/index.mjs` o `server/host.mjs`; GameHost sigue creando `ProfileSessions` de M5.
No hay duplicación activa de mochila causada por A1, pero seguir con dos integraciones repetiría trabajo.

| Responsabilidad | Dueño e integración |
|---|---|
| Cuenta/personaje, scope mundo/época, admisión/cierre, reserva y versión del perfil | M5; una decisión de identidad y una autoridad viva |
| Autosave, diario, arranque, recuperación y muerte/perlas/botín | M5; conservar sus writers y gates hasta una transición coordinada |
| Requisitos, remanente y progreso de la Carpintería de Salty Shore | A1; reutilizar `contributionContract.mjs` y sus casos de conservación |
| Débito de materiales + crédito de obra + recibo exacto | Transacción incorporada a la autoridad M5 por su dueño, usando la misma fila/versionado del personaje; A1 aporta reglas y pruebas |
| Tablero/receptor físico, artesano, enseñanza y presentación de progreso | Mecánicas A1; consumir el resultado confirmado, sin implementar otro guardado |
| Arranque operativo, configuración y aceptación del servidor con amigos | Continuidad/M5; despliegue de un commit revisado y un proceso por mundo |

Se reutilizan las pruebas de replay, rollback, CAS, identidad reemplazada, respuesta perdida y
estado actual posterior al recibo. El scope `worldId/worldEpoch/characterId` es un requisito de
aislamiento que debe resolver el dueño M5; este documento no elige silenciosamente una migración
de sus perfiles actuales, aún ligados al UUID de cuenta.

El seam jugable de aportes deberá recibir identidad y acceso físico derivados por el servidor,
reservar la mochila existente, confirmar débito/obra/recibo juntos y publicar en su tick autorizado.
Un segundo envío del mismo UUID no cobra otra vez. Un timeout conserva la reserva y se reconcilia;
un snapshot viejo del recibo nunca reemplaza el perfil actual. No añadir un endpoint administrativo
de retry al protocolo del jugador. Nombres de API y migración quedan a cargo del dueño M5.

## Qué está conectado hoy

El arranque habitual es `npm start` → `storeFromEnv` / Auth → `GameHost.prepare()` → listener.
Sin configuración Supabase selecciona memoria. Con cuenta autenticada y Supabase guarda el perfil
CAS; el invitado conserva un blob firmado en el navegador. `WorldState` restaura la economía antes
de admitir y guarda cada 60 segundos y al cierre. Son snapshots separados, no una transacción
general que confirme todas las acciones económicas.

| Estado | Cobertura actual y límite |
|---|---|
| Materiales cosechados, herramientas, equipo, oro y progreso personal | En el perfil; cuenta + Supabase para guardado del servidor. El blob invitado depende de navegador/origen/secreto |
| Plano, carga, condición y pose naval codificada | Datos del perfil de balsa; no acredita custodia de barcos desconectados ni persistencia de toda la simulación |
| Mercados, solares y producción económica | Snapshot de `economy.serialize()`; Supabase para sobrevivir al proceso. Caída abrupta puede perder cambios recientes |
| Golpes, agotamiento y reaparición de recursos | Estado de sesión en `resources.js`; reiniciar el host los reinstala |
| Perlas/botín, muerte y recuperación D09 | Montajes explícitos disponibles; `npm start` no inyecta staging/startup. No habilitarlos solo porque existen SQL/tests |
| Obras comunitarias y recetas nuevas | Contratos A1 aislados y dirección de juego; todavía sin receptor/tablero/aprendizaje conectados |

Fuentes principales: `server/index.mjs`, `server/host.mjs`, `server/profileSessions.mjs`,
`server/worldState.mjs`, `src/net/localServer.js`, `src/sim/systems/resources.js`,
`src/sim/systems/rafts.js`, `docs/delivery/d09f-pearl-lifecycle-host.md` y
`docs/delivery/a1b2b4-journal-sessions.md`. Ninguna cobertura de esta tabla equivale a evidencia live.

## Aceptación de la partida con amigos

1. Identificar URL/servicio destino y commit exacto. Mantener un solo proceso escritor, `WORLD_ID`,
   secreto de firmas y base de datos estables; no ejecutar PC y VPS sobre la misma autoridad.
2. Verificar en el destino `/health`, `/status.storage` y `/auth/config`: store durable, cuentas,
   mundo listo, sin errores/guardados retenidos, y gates realmente montados. Un HTTP 200 aislado
   no demuestra durabilidad. No publicar credenciales ni leerlas en un informe.
3. El dueño M5 verifica esquema/RPC/ACL necesarios para el montaje elegido y cierra su arranque,
   hidratación, reloj y política de recuperación antes de habilitar operaciones D09. A1 no los duplica.
4. Aceptación automática con dos cuentas de prueba: obtener materiales, fabricar herramienta/pieza,
   cargar/editar/dañar balsa y comerciar; esperar confirmaciones, reconectar y reiniciar el proceso
   real. Comparar perfiles, carga, condición, economía y fuentes afectadas; probar también respuesta
   perdida/replay y el caso de caída definido por M5. No contar un reinicio limpio como prueba de crash.
5. Publicar únicamente la cobertura que haya pasado. Hasta cerrar persistencia de recursos y
   transacciones entre perfil/mundo, no afirmar «se guardan todas nuestras acciones» ni mundo
   conservado completo hasta wipe. La política offline sigue siendo una decisión pendiente.

Inspección operativa de este corte: no se encontró listener local entre 5173 y 5194; la URL HTTPS
guardada por el lanzador el 2026-10-06 devolvió **404** en `/health`, `/status` y `/auth/config`.
Es evidencia de ese enlace, no prueba sobre un VPS distinto. No se leyó `.env`, aplicó SQL,
reinició servicio, abrió una segunda autoridad ni se dio por desplegado el repositorio.

Regresión del camino existente ejecutada en este árbol: **54/54** en `store-host`,
`accounts-server`, `world-state`, `world-host`, `raft-persistence` y `harvest-tools`.
Son fixtures locales; no validan credenciales, servidor público o reinicio live. Las seis fuentes
de A1b2b4 mantienen los hashes de su aceptación previa de 165 casos y pasan sintaxis.

Después de coordinar este contrato con continuidad, nuestra cola vuelve a las mecánicas de
Salty Shore: receptor/tablero → carpintero → aprendizaje → fabricación de contenido nuevo,
integrados en la mochila M5. Se conservan recetas/piezas ya disponibles y anclas del mapa.

Reutilización: no se añade lógica runtime ni arte en esta revisión; se usan los módulos y pruebas
existentes. El cruce Unreal del receptor/banco está documentado en A1b2b4; fuentes intactas.
