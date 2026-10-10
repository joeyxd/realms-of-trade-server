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

Pendiente de revisión final y publicación selectiva. No se aplicó SQL016 ni se modificaron secretos,
flags o el mundo del VPS en este corte. La confirmación del autor de SQL015 no se interpreta como
aplicación de SQL016. Se entrega el archivo nuevo después de validarlo; después se acepta el runtime
compatible y el flujo autenticado antes de declarar Tala activa públicamente.

Sigue PRG01c: artesano, enseñanza personal y primera bodega; aislamiento de personajes/mundos y
composición completa con perlas/muerte/botín continúan en AREA15.
