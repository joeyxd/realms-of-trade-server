# AREA15: perlas nuevas de élites y cofres

Continúa [muerte y botín](m5-ground-death-lifecycle.md).
[Contrato](../briefs/m5-ground-pearl-mint.md). Sin migración, flag ni protocolo nuevos.

## Implementación

`mountGroundPearls(); mountGroundDeaths(); mountGroundPearlMints();` añade las perlas
públicas recién sorteadas por `lootOnKill` y `openChest` al dueño común de tick y diario.
El montaje es explícito, con host vacío y detenido, antes de `prepare()`. Sin montaje
las rutas existentes mantienen su comportamiento inmediato.

La captura ocurre antes de insertar suelo, ledger o evento y retiene la publicación del
tick completo. Un UUID generado una vez define tanto la operación como el UID `mint:<UUID>`.
El único `beforeTick` termina primero las muertes y luego confirma cada mint en orden;
solo publica al terminar todos. Los plazos se calculan desde el tick de origen con el
epoch común, conservando la pausa offline. No repite tiradas ni consume RNG al aplicar.

SQL004/018/019 confirman la fuente nueva, ubicación, mundo/reloj y recibo sin modificar
cuentas. El drain síncrono instala juntos drop, ledger, índice de filas actuales, allocator
y evento. Revalida perfiles, contenedores, geometría, cursor RNG y callbacks del dueño;
un fallo revierte sus escrituras locales y cerca el host. Recuperar el diario precede
a hidratar filas actuales, sin eventos históricos ni callbacks del proceso anterior.

## Aceptación y publicación

**16/16 casos nuevos correctos.** La cohorte conjunta tiene **1063/1064 en 106 archivos**,
un fallo heredado y cero omisiones, con fuentes congeladas
antes/después y base `ff45e49`: [manifiesto](m5-ground-pearl-mint/acceptance.json),
[TAP](m5-ground-pearl-mint/acceptance.tap). Incluye rutas reales sentinel/cofre, muerte y mint
simultáneos, dos mints en un tick con UUID distintos, publicación retenida, rollback,
cierre antes/después del commit y reemplazo del callback durante IO.

Dos SIGKILL nuevos interrumpen procesos reales tras preparar SQL019 y tras commit SQL,
antes de aplicar. Reabrir PGlite persistente sin migraciones recupera exactamente un
recibo/fila, sin eventos ni callbacks históricos, y permite recoger la perla una vez.
La cohorte conserva muerte/suelo, Carga/atributos/sobrepeso, taller/recursos, agua/cantimplora,
costa y GM033/materiales. Conteos solapados con las entregas anteriores.

El único fallo es `Cometa cannot rush through a collider or enter deep water`: también
falla aislado en upstream `fb4276f`, con test, movimiento y skills idénticos a este corte.
Es una regresión real de movimiento al nadar; no se cambió la prueba ni el runtime para
ocultarla. [Comparación](m5-ground-pearl-mint/upstream-cometa.json),
[TAP upstream](m5-ground-pearl-mint/upstream-cometa.tap) y
[evaluación](m5-ground-pearl-mint/acceptance-evaluation.json). No se declara toda la cohorte verde.

Integración concurrente **137/137 en 24 archivos**, cero fallos/omisiones y fuentes
congeladas, base `c535e5d`: [manifiesto](m5-ground-pearl-mint/concurrent-integration.json),
[TAP](m5-ground-pearl-mint/concurrent-integration.tap). Conserva la release alpha.56/protocolo 56,
creación de compañeros/SQL034, dispersión decorativa GM, Carga, contenido y red junto al
mint/muerte comunes. SQL034 pertenece al corte de compañeros y mantiene su activación separada;
AREA15 no añade ni ejecuta SQL. Los conteos se solapan con la aceptación principal.

Integración posterior **28/28 en 6 archivos**, fuentes congeladas, base `b89a2d9`:
[manifiesto](m5-ground-pearl-mint/visual-integration.json),
[TAP](m5-ground-pearl-mint/visual-integration.tap). Conserva alpha.57/protocolo 56 y
la animación de ficha del Bucanero; el core de servidor/suelo/mint de la integración
anterior permanece idéntico. No repite la aceptación visual del corte de personaje.

Código listo para publicación; despliegue aún pendiente del actualizador en mundo vacío.
El [estado inicial](m5-ground-pearl-mint/initial-status.json) y la
[lectura inicial del dominio](m5-ground-pearl-mint/initial-domain.json) mantienen el piloto
apagado. No se ejecutó SQL ni gameplay durable de QA en el VPS por este corte.

## Límites y continuación

El recibo cubre la perla pública nueva, no el sobre completo de kill/cofre: oro, equipo,
XP/misiones, consumo del cofre y cursor RNG entre procesos requieren otro contrato.
Una caída antes de preparar intención durable puede perder el candidato. Después de
prepararla, la recuperación debe dejar exactamente una perla actual.

Cerrar con un candidato todavía sin preparar no lo confirma ni publica y rechaza el
flush; cerrar después del commit conserva el recibo, sin aplicación tardía. Desconectar
durante el tick retenido cerca el host. Estos límites impiden declarar durable todo el loot.
SIGKILL local no acredita pérdida eléctrica/disco, concurrencia entre backends ni lease.

Siguen los comandos restantes de perlas y el sobre completo de loot nuevo; después,
transición detenida, exclusión del escritor anterior/actualizador, adopción explícita
y canario autenticado de caída/reinicio en el VPS. No se activa ni adopta el mundo público
por este corte. La exclusión de activación GM permanece vigente.

Se reutilizan los helpers de loot, planes reversibles, fuente actual y recibos existentes.
Los candidatos Unreal `BP_AILootSpawner` (221298 B) y `BP_JigServerSave` (580554 B) se
verificaron físicamente: sus paquetes Blueprint no ejecutan el contrato Node/Postgres.
Fuentes Unreal intactas, sin assets/UI nuevos. Trabajo aislado en `area15-resource-live`;
el checkout IDE recibe solo documentación acotada, preservando su trabajo concurrente.
