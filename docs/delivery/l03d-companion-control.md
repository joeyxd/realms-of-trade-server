# L03d-d — Detención durable del compañero

2026-10-10. [Contrato](../briefs/l03d-companion-control.md), continuación de la
[ficha privada](l03d-companion-config.md) dentro de AREA17.

## Resultado

«Mis compañeros» permite detener y permitir una conexión nueva para un compañero ya vinculado
por el operador. Detener revoca el grant y descarta entradas pendientes antes de esperar a SQL.
Solo la confirmación de SQL027 acredita el guardado. La decisión se recupera al reconstruir el host;
sin fila, o si la recuperación falla, los agentes quedan detenidos y las personas pueden entrar.

La revisión durable y el epoch de control se comprueban por separado. Ante conflicto, timeout o
respuesta tardía, leer puede recuperar evidencia pero nunca reanuda un personaje detenido localmente.
«Permitir conexión» exige acción explícita, no arranca la mente ni renueva el grant anterior.
La UI ES/EN distingue detención por defecto, confirmada, pendiente y local sin confirmar.

SQL027 es metadato privado de control en la instancia M5: no modifica perfiles, mundo ni recibos
de gameplay. El allowlist del host conserva dueño, personaje y capacidades. No crea vínculos,
cuentas, conexiones, credenciales, presupuestos o memoria; SQL025 todavía no alimenta la mente.
Las rutas legacy no pueden saltarse el control durable. Una sola autoridad; sin prueba entre réplicas.

## Validación

[Pruebas locales](l03d-companion-control/local-tests.json),
[recorrido de navegador](l03d-companion-control/browser.json) y
[canario SQL real](l03d-companion-control/live-sql.json) se registran por separado.
El navegador usa autenticación simulada, gameplay en memoria y SQL027 en disco; no acredita
un dueño autenticado público. El canario real usa scope ficticio y revierte todas sus escrituras.
[Readiness desde VPS](l03d-companion-control/live-readiness.json) confirma versión 1 y fixture ausente.

La selección local pasa **190/190**, sin fallos, cancelaciones ni omisiones, y verifica que los
archivos no cambien durante la ejecución. El navegador pasa **14 comprobaciones**: dos dueños,
revocación/permiso, timestamps de SQL, recarga, fallo/confirmación, logout y reconstrucción del host
tras reabrir la base. Las cinco capturas originales se inspeccionaron; escritorio ES/EN y vistas
844×390/390×844, con controles de 44 px y sin salir del viewport. Sin errores de página; se registran
cuatro respuestas HTTP 503 de los fixtures locales, no atribuidas por este recorrido. No es aceptación
de rendimiento físico móvil ni de autenticación pública.

## Recuperación previa

Se integró el upstream `8f66e97`. El alfa existente `f939152` estaba bloqueado por el rechazo
SQL024 del ID de balsa con `:` durante el canario de Carpintería. Se aplicó la reparación
[SQL026](../../server/migrations/026_workshop_raft_identifiers.sql), validada por 10 pruebas locales,
y se ejecutó el procedimiento guardado del mismo contenedor bajo los locks del actualizador.
[Evidencia](l03d-companion-control/prerequisite-recovery.ndjson): pasó de una operación pendiente
y un guardado fallido a cero, conservando hashes de nodos, cooldowns, ledger, comunidad y semilla,
además del crédito y kit QA. La [limpieza exacta](l03d-companion-control/retained-qa-cleanup.json)
retiró solo Auth/perfil del fixture retenido y conservó sus seis recibos. SQL023/024 y sus flags
ya estaban instalados/activados; no se repitió adopción ni activación.

## Publicación

Runtime preparado como alpha.37/protocolo 46. La revisión activa, imagen exacta, pruebas de imagen,
entrada WSS pública y capturas públicas quedan pendientes de verificar después del relevo.
El guardado/stop/resume de un dueño público con binding real sigue pendiente; no se provisiona
uno para presentar ese criterio como aprobado.

## Siguiente tramo

Conexión/modelo admitidos y techo de gasto compartido. Después, integrar personalidad/metas
en AgentMind y memoria con eventos confirmados, fuentes, vigencia, recuperación y borrado trazable.
El canario completo debe conversar, ayudar en PvE y recordar un acuerdo en otra sesión con coste medido.
