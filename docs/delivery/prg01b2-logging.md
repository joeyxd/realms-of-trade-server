# PRG01b2 — aprendizaje de Tala sobre M5

2026-10-10. [Contrato y montaje](../briefs/prg01b2-logging.md).

## Implementado localmente

- Práctica proporcional con presupuesto fijo al concluir una palmera; dos troncos para el último golpe.
- Ledger persistente, ciclos y adopción legacy sin inventar autoría ni premios retroactivos.
- La operación M5 existente confirma todos los perfiles, recurso, reloj y recibo juntos; contempla
  participantes conectados/desconectados, CAS, respuesta perdida y replay histórico.
- Hito 60 y beneficio 54→45 ticks en golpes posteriores; ficha Oficios/Trades ES/EN y temporizador
  basado en perfil/ACK autoritativo. No enseña recetas ni entrena combate.
- SQL016, comprobación de capacidad y montaje opt-in `MN_LOGGING_OPERATIONS=1`.

## Verificación

**230/230 pruebas integradas**, sin omitidas: [comando y resultados](prg01b2-logging/validation.json)
y [registro TAP](prg01b2-logging/integrated.tap). Incluye la regresión de release, perfil/progresión,
recursos, pilotaje y siete suites nuevas de Tala (38 casos). SQL001–016/PGlite y adaptador Supabase
comprueban recibos 014/015 intactos, reaplicación, permisos, reparto 7/3 y 4/3/3, tope, hito y pilotaje v2.
Solicitudes que inventan práctica/carga/cooldown, omiten participantes o reutilizan un ciclo se rechazan
sin escritura parcial. Crafting, minería y comercio conservan las palmeras y el ledger correspondientes.

Dos casos terminan el proceso con SIGKILL antes/después del commit SQL, sin cierre ordenado de host/DB.
Un segundo proceso reabre la misma base sin reaplicar migraciones: antes no queda premio parcial;
después sobreviven ambos perfiles, nodo y recibo. El reintento exacto produce una sola recompensa.
Esto no simula pérdida de disco, corte eléctrico, varios backends SQL concurrentes ni caída del VPS real.

El [harness de navegador](../../tools/qa-logging.mjs) usa el `CharPanel` real y perfiles locales, con
animaciones GSAP sustituidas. Sus [ocho comprobaciones](prg01b2-logging/ui/evidence.json) incluyen
ES/EN, práctica 30/60 y escritorios 1280×720 / móvil emulado 390×844. Sin overflow o errores de página;
capturas representativas inspeccionadas. No es una sesión pública ni prueba de teléfono físico.

## Publicación y activación

Código `00d38c5`, integrado con el cierre concurrente de AREA15 en `56e4345`. El 2026-10-10 a las
19:19 UTC se verificó la revisión activa **`56e4345b0b83ba58521d91f55b71891e126b0988`**, imagen
`marea-negra:alpha-56e4345b0b83`, una instancia sana y health público 200. El actualizador pasó
**107/107 pruebas offline** en esa misma imagen antes del relevo. Supabase, cuentas y recursos
permanecen habilitados/listos, sin bloqueo de tick ni errores de storage; timer activo.
[Revisión, imagen y status](prg01b2-logging/live-release.json).

El [smoke público](prg01b2-logging/public-smoke.json) pasó **6/6**: salud, alpha.24 compatible con
Tala apagada, protocolo 36, módulo de ficha publicado, SQL privado y entrada real de invitado por WSS
con perfil/snapshot. Esa entrada no acredita un premio de Tala autenticado.

**Activación aceptada, 2026-10-10:** el autor aplicó [SQL016](../../server/migrations/016_logging_operations.sql)
y el servicio verificó su readiness. Se habilitó `MN_LOGGING_OPERATIONS=1` sobre `758a217` (alpha.25,
protocolo 37), deteniendo y reabriendo la misma autoridad. La [adopción](prg01b2-logging/activation.json)
v1→v2 conservó exactamente reloj, 206 nodos, revisiones, golpes, plazos y cooldowns; 96 palmeras,
una con ciclo legacy sin crédito retroactivo. Un primer probe durante el relevo de Traefik falló;
los siguientes health/status y WSS pasaron. Mantener el flag y un runtime compatible con v2.

El [canario autenticado](prg01b2-logging/logging-live-acceptance.json) usó dos cuentas sintéticas y
comandos normales por TLS/WSS. Dos golpes de A y uno de B otorgaron 7/3; B estaba desconectado al
concluir y reentró con su práctica. A pasó de 53 a 60; el golpe del hito conservó 54 ticks y los
siguientes usaron 45. Una denegación por mochila llena quedó registrada; crafting y venta cotizada
hicieron espacio. La siguiente conclusión individual dejó A70/B3 y ambos ciclos completos.

Se conservaron nueve recibos (ocho éxitos y una denegación). Tras el [reinicio ordenado](prg01b2-logging/restart.json)
en `454e2da` (alpha.26/protocolo 38), perfiles completos/versiones, nodos, plazos y contribuyentes
coincidieron con el checkpoint. Los nueve replays exactos conservaron perfiles/versiones y nodos/ledger,
sin duplicar práctica ni bienes. Se eliminaron únicamente las dos cuentas Auth/perfiles sintéticos,
conservando recibos e historial del mundo. El [status final](prg01b2-logging/final-live-status.json)
a las 20:08:38 UTC verifica revisión/imagen, una instancia sana, timer activo y cero errores o pendientes.
El [smoke activo](prg01b2-logging/public-active-smoke.json) pasó 6/6 con entrada pública real.

La [regresión sobre upstream integrado](prg01b2-logging/activation-validation.json) pasó 31/31 sin
omitidas; las 230 pruebas y ocho comprobaciones visuales anteriores conservan su evidencia histórica.
Este reinicio tuvo 19 875 ms de indisponibilidad medida. El plazo de la palmera ya había transcurrido
antes del apagado: se verificó su consistencia, pero no se midió una nueva pausa offline v2.
La política de pausa y la aceptación anterior de AREA15 siguen vigentes; no hubo SIGKILL del VPS
en esta activación de Tala ni prueba de pérdida de disco.

Las [notas del harness](prg01b2-logging/harness-notes.json) registran un selector inicial corregido
sin enviar acciones y la pérdida de archivos QA temporales durante un relevo concurrente. Los datos
M5 sobrevivieron; se reconstruyó exclusivamente la fixture sintética desde perfiles/recibos intactos,
se respaldó fuera del contenedor y se realizó después el reinicio controlado y los nueve replays.

`tools/qa-logging-live.mjs` es una herramienta de operador que modifica el mundo real y exige
autoridad sana e idle antes de iniciar. Sus fases son `before`, `resume` (solo tras interrupción),
`after` y `cleanup`; requiere configuración service-role existente y una fixture privada con modo 600.
Guardar esa fixture fuera del contenedor antes de reiniciarlo: `/app` es de solo lectura y `/tmp`
es efímero. No publicar credenciales/fixture. Completar los ciclos sintéticos antes del cleanup;
la herramienta verifica propiedad exacta y conserva recibos/mundo.

Sigue PRG01c: artesano, enseñanza personal y primera bodega; aislamiento de personajes/mundos y
composición completa con perlas/muerte/botín continúan en AREA15.
