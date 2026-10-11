# AREA03 INV02b — entrega de Carga durable

Contrato: [adopción, asignación y reasignación](../briefs/inv02b-durable-attributes.md).
Implementado y publicado sobre M5, protocolo 49/alpha.43. Código desplegado y verificado en
`f281db1`, con Carga apagada. Activación pública pendiente de SQL029 y su canario.

El perfil conserva `attr` al cargar/sincronizar, al mejorar mochila y al recibir Tala offline.
Nivel 1 y packs previos al taller tienen adopción explícita sin perder objetos. El éxito se
publica solo después del commit; timeout/replay mantienen identidad y un replay histórico
no restaura un perfil anterior. Autosaves y otros comandos económicos no pueden gastar,
introducir o borrar puntos. No se añade UI de asignación ni penalización de movimiento.

## Verificación

[Comandos y resultados](inv02b-tests.json). Los conteos posteriores incluyen los casos nuevos.

- Regresión integrada previa: **106/106**, 14 archivos, host/store, carry/taller, Tala
  cooperativa y frontera común de suelo. Posteriormente se añadió el caso de revisión
  atrasada y se amplió el caso SQL de composición; esos archivos se verifican de nuevo abajo.
- Atributos final: **19/19**, tres archivos. Incluye 11 casos GameHost, cuatro de contrato/
  memoria y cuatro SQL029 sobre SQL001–028, reaplicación, permisos, adopción legacy/tier 1,
  asignación directa, reset, masa, CAS/replay, ACK falsificado y sobreflujo de tick.
- UI existente: **6/6** ES/EN × desktop/portrait/landscape, controles reales del taller,
  masa adoptada 60 y volumen mejorado 30. El ACK mantiene pendiente hasta el perfil confirmado.
  [Capturas y alcance](inv02b-ui/2026-10-11T04-20-37-686Z-31696/README.md), inspección visual
  portrait ES y landscape EN. Taller con CSS real y scroll interno; el pack se posiciona/
  escala solo en el fixture para no taparlo. No es aceptación física de teléfono.
- Composición final SQL023/029: **1/1** con GameHost y PGlite en disco. Adopta, asigna y
  reasigna, recoge madera, fabrica caja y construye bodega por el journal común; conserva
  los seis recibos. Cierra/reabre la base y el replay antiguo de adopción mantiene el perfil
  posterior. No simula caída de VPS ni corte de alimentación.

Los conteos se solapan; no sumarlos como casos únicos. Las pruebas de memoria/SQL local
no sustituyen aceptación autenticada pública de Carga.

## Publicación y despliegue

Código `f281db1`; herramienta pública/configuración/evidencia posterior `cfeb19e`, rama
`claude/loving-lovelace-ptbif7`, PR existente #1. El actualizador normal desplegó alpha.43
sin activar Carga. [Canario público con flag apagado](inv02b-public/20261011T042205Z-off/acceptance.json)
**5/5**: salud, versión/protocolo, cuenta temporal, entrada autenticada WSS y reconexión;
adopción rechazada `disabled`, sin recibo ni cambio del DTO legado/masa 22 del nivel 3.
Cuenta Auth/perfil temporales retirados. No es prueba de UI pública de asignación.

[Revisión e imagen fijas](inv02b-public/20261011T042205Z-off/authority.ndjson) bajo locks del
actualizador y contenido; 14 hashes de archivos de la imagen iguales a Git. Una autoridad,
Supabase durable, cero errores/guardados pendientes antes y después, timer activo. Sin
reinicio forzado ni otra autoridad. La evidencia verifica `f281db1`; los commits posteriores
de documentación/herramientas no representan una activación de Carga.

## Reanudar

1. Ejecutar [SQL029](../../server/migrations/029_attribute_operations.sql) en Supabase después
   de 001–028; comprobar readiness sin editar perfiles o recibos existentes.
2. Activar por configuración con la única autoridad en reposo y comprobar canario autenticado
   de adopción/asignación/reasignación, reconexión y replay, conservando sus recibos.
3. INV02c: ficha ES/EN y controles de puntos con estado pendiente; después sobrepeso y dash.

El borrador vecino `inv02-survival` sigue separado. No ejecutar su SQL028 candidato:
la rama integrada ya utiliza SQL028 para configuración de inferencia.
