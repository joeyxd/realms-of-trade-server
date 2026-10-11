# AREA03 INV02b — entrega de Carga durable

Contrato: [adopción, asignación y reasignación](../briefs/inv02b-durable-attributes.md).
Implementado, publicado y activado sobre M5, protocolo 49/alpha.43. SQL029 aplicado y
readiness verificado desde el contenedor. Carga activa en `024610b`; canario público
autenticado **5/5**, con adopción, asignación, reset, replay, conflicto y reconexión.

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
reinicio forzado ni otra autoridad. La evidencia con flag apagado verifica `f281db1` y
conserva su alcance histórico.

El autor confirmó SQL029 aplicado. [Activación](inv02b-public/20261011T044137Z-activation/activation.ndjson)
en `024610b6df940cbf8cdfd5d6bb2ee06c84ed94d0`, imagen
`sha256:0ec92e7a66f4858c84a5c4f4d2b584c4daa6055bdc1905f8279de1a4a3577777`.
Con locks del actualizador/contenido y cero jugadores, se comprobó readiness SQL029 desde
el contenedor y se cambió únicamente `MN_ATTRIBUTE_OPERATIONS=1`, preservando las demás
variables privadas. Se detuvo la autoridad anterior antes de recrear el mismo servicio/imagen.

[Canario activo y alcance](inv02b-public/20261011T044148Z-active/README.md): **5/5** por WSS
público autenticado. Perfil temporal nivel 3: adopción explícita, asignación de dos puntos,
reset gratuito, replay histórico sin rollback, conflicto durable por revisión atrasada sin
fence, comparación base/snapshot y reconexión con Carga 0, reset usado y masa máxima 50.
Cuenta Auth/perfil retirados; cuatro recibos económicos conservados. [Autoridad fija](inv02b-public/20261011T044148Z-active/authority.ndjson),
14 hashes iguales a Git, Supabase durable, flag habilitado/listo, cero jugadores, errores o
guardados pendientes antes/después y timer activo. Es aceptación del contrato público de
comandos; la pantalla de asignación y el sobrepeso jugable siguen pendientes.

## Reanudar

1. INV02c: ficha ES/EN y controles de puntos con estado pendiente/rechazado, adopción visible
   y confirmación del perfil. Reutilizar el contrato activo; no introducir otro escritor.
2. Después: sobrepeso y dash compartidos entre host/predicción.

[SQL029](../../server/migrations/029_attribute_operations.sql) y la activación ya están
comprobados; no requieren reaplicación para continuar INV02c. El flag sigue apagado por
defecto en nuevas instalaciones y exige taller/readiness para activarse.

El borrador vecino `inv02-survival` sigue separado. No ejecutar su SQL028 candidato:
la rama integrada ya utiliza SQL028 para configuración de inferencia.
