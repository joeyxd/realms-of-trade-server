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

**Pendiente: aplicar [SQL016](../../server/migrations/016_logging_operations.sql) completo tras SQL015.**
No se aplicó SQL016 ni se cambiaron secretos o flags en este corte. `MN_LOGGING_OPERATIONS` continúa
apagado; no se adoptó el ledger v2 del mundo público. La confirmación de SQL015 no se interpreta como
aplicación de SQL016. Después se activa el montaje compatible y se acepta el flujo autenticado,
incluidos cooperación, desconexión y recuperación, antes de declarar Tala activa públicamente.

Sigue PRG01c: artesano, enseñanza personal y primera bodega; aislamiento de personajes/mundos y
composición completa con perlas/muerte/botín continúan en AREA15.
