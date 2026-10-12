# AREA15 â€” regalar perlas con el recibo comÃºn

ContinÃºa [leave](m5-ground-pearl-leave.md) y la
[matriz derivada de los planes](../CONTINUITY-MATRIX.md), desde `1417975`.
[Contrato](../briefs/m5-ground-pearl-give.md). Sin migraciÃ³n, flag, UI ni protocolo nuevos.

## Resultado y autoridad

El montaje explÃ­cito `mountGroundPearls()` admite ahora `pearl/give` gratuito entre
dos cuentas autenticadas. Solo una perla de `pearls.bag`; la tragada sigue ligada
hasta morir. Conserva calma, vida, alcance y lÃ­mite de bolsa mediante `transferPearl`
sobre una vista separada. No mueve afinidad ni dinero. Venta con pago queda para
su propio contrato; NPC no compra perlas y swallow sigue cerrado en este piloto.

El comando solo selecciona UID y entidad receptora. Resuelve la sesiÃ³n/identidad
actual del receptor, rechaza campos extra de autoridad y reserva ambas cuentas y
todos sus UIDs antes de IO. Asienta progreso previo de ambos, incluidos autosaves
en curso; un guardado de la otra cuenta puede finalizar mientras se asienta la
primera. Solo admite ese avance acotado con el mismo conjunto de perlas y exige
el snapshot final capturado antes de construir la transacciÃ³n. Rechaza agotamiento
del contador de versiÃ³n antes de reservar o iniciar esos guardados.

Consulta holder/generaciÃ³n actuales y la ubicaciÃ³n del UID. Una ubicaciÃ³n existente
debe ser del mismo mundo, de la misma generaciÃ³n y con `ground:null`. Un UID legacy
registrado en SQL003 sin fila de ubicaciÃ³n puede adquirir su primer tombstone;
no se asume generaciÃ³n 1 para entregar. Familia `ground` SQL004/018/019 confirma
ambos perfiles CAS, nuevo dueÃ±o/generaciÃ³n, ubicaciÃ³n, mundo/reloj y peticiÃ³n exacta.

Durante IO no cambia bolsas, ledger ni eventos. El drain sÃ­ncrono aplica ambas
sesiones/perfiles, ledger, dirty y eventos `pearlChanged(give)`/`pickup` juntos.
Verifica identidades, callbacks, baseline, ECS, RNG, drops y asignadores. Un fallo
en segunda sesiÃ³n o append parcial revierte la proyecciÃ³n local y cerca el host;
SQL confirmado permanece autoritativo para recuperaciÃ³n. DesconexiÃ³n, muerte,
reciclado de entidad, cierre y sustituciÃ³n de hooks tampoco aplican sobre otro cuerpo.

## AceptaciÃ³n local

[Manifiesto y fuentes](m5-ground-pearl-give/acceptance.json),
[TAP](m5-ground-pearl-give/acceptance.tap): adaptador separado, comando real,
reserva previa de ambas cuentas y UIDs del receptor, progreso de ambos, commit
retenido, competencia, respuesta perdida con peticiÃ³n idÃ©ntica, lÃ­mites de versiÃ³n,
rollback y cerco del host. La ruta sin montaje conserva el helper existente.

Dos procesos reales se terminan con SIGKILL tras preparar la intenciÃ³n SQL019 y
tras commit antes de apply. Se reabre PGlite persistido **sin ejecutar migraciones**:
peticiÃ³n/UUID exactos, diario confirmado, ambos CAS y mundo/reloj coherentes, una
copia y un dueÃ±o, tombstone de generaciÃ³n nueva y cero callbacks/eventos histÃ³ricos.
Una entrega posterior desde el receptor prueba otra generaciÃ³n; no restaura perfiles
histÃ³ricos del recibo anterior.

[Regresiones pertinentes](m5-ground-pearl-give/regression.json) y
[TAP](m5-ground-pearl-give/regression.tap) cubren las rutas comunes anteriores,
economÃ­a/recursos/Tala/taller, Carga, agua/cantimplora/comidas y exclusiones GM/compaÃ±eros.
El único fallo de la cohorte fue la expectativa HTML antigua del aviso `commandDenied`:
la traducción añadió el wrapper fijo `data-l10n-html`, manteniendo texto, destinatario y privacidad.
Se reprodujo sin cambios en upstream `6f997ce` ([control](m5-ground-pearl-give/upstream-toast.json),
[TAP](m5-ground-pearl-give/upstream-toast.tap)). Se actualizó solo la expectativa exacta del test,
sin cambiar el componente ni relajar la comprobación de UID/perfil/recibo. El archivo completo y
la ruta compatible repiten **27/27 en dos archivos** ([seguimiento](m5-ground-pearl-give/regression-followup.json),
[TAP](m5-ground-pearl-give/regression-followup.tap)). El seguimiento acredita que ese test es la única
fuente distinta de la cohorte; no se repitieron sus 51 archivos ni se declara verde su resultado original.
Implementación `3862a7c`, integración/regresión `3de3b53`; las fuentes de aceptación give siguen iguales.

Las fuentes se congelan durante cada cohorte. Los conteos incluyen subtests y se
solapan con entregas anteriores; esta cohorte no representa la suite general completa.

## PublicaciÃ³n y lÃ­mites

[Lectura previa VPS](m5-ground-pearl-give/initial-status.json) y
[dominio previo](m5-ground-pearl-give/initial-domain.json): `1417975`, alpha.64 sano,
Supabase/cuentas, tres bots, base de contenido generaciÃ³n 8; montajes comunes nulos,
sin reloj adoptado ni filas/intenciones de suelo. Son lecturas separadas y fechadas.
La publicaciÃ³n del cÃ³digo de este corte se registra despuÃ©s de aceptar sus pruebas;
no se declara gameplay durable pÃºblico de give por publicar archivos.

El piloto comÃºn permanece apagado. Siguen swallow sin reemplazo/expulsiÃ³n, candidato
completo kill/cofre (recompensas/XP/misiÃ³n/RNG antes de intenciÃ³n), composiciÃ³n con
recursos GM/compaÃ±eros/control/bots, adopciÃ³n detenida y canario autenticado VPS.
Las exclusiones actuales se conservan. SIGKILL local no prueba pÃ©rdida elÃ©ctrica,
disco, PostgreSQL con dos backends ni lease entre procesos. Antes de la intenciÃ³n
durable aÃºn puede perderse un comando sin confirmar; no se entrega Ã©xito anticipado.

ReutilizaciÃ³n concreta revisada en el [inventario ActionRPG](../research/unreal-assets/actionrpg/FINDINGS.md):
`BP_InventoryComponent` tiene UID/transferencias/distancia y `BP_JigServerSave`
referencia guardado Blueprint. No ejecutan Node/Postgres ni prueban CAS/durabilidad.
Se reutilizan los helpers/coordinadores JS y SQL existentes; fuentes Unreal intactas,
sin assets, arte o cambios visuales propios de este corte.
