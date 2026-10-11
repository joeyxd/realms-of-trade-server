# Centro público: corregir el formulario sin siguiente paso

2026-10-11. [Contrato](../briefs/l03d-public-inference-availability.md).

El autor estaba en el alfa público y no había introducido ninguna URL. La pantalla
mostraba el tope compartido aunque no había conexiones seleccionables ni compañeros
creables. El problema precedía cualquier intento de conexión al modelo.

## Implementado

El panel explica la disponibilidad real en ES/EN. Con catálogo vacío y sin valores
previos, el centro presenta una explicación y permite volver al juego o recargar;
no solicita gasto ni muestra Guardar. Una configuración o borrador previo permanece
visible y de solo lectura hasta recuperar catálogo. Modelos, límites y selecciones
no se eliminan. El formulario admitido y las barreras de guardado se conservan.

Se reutiliza la UI actual; no assets nuevos, migraciones, protocolo ni activación de
runtime. No hubo llamadas al modelo ni cambios en credenciales, cuotas o datos vivos.

## Comprobaciones

- 56/56 pruebas pertinentes de UI, cliente y red de compañeros/configuración.
- Navegador local: 19/19 comprobaciones, cero errores. Host real con autenticación
  simulada, catálogo vacío y `agentControl: null`, ES/EN, 1440×900 y 390×844.
  SQL028 reabierto desde disco con la configuración intacta. [Evidencia](l03d-public-availability/browser/browser.json)
  y [pruebas](l03d-public-availability/tests.tap). Capturas vacías ES móvil/EN escritorio
  y configuración previa EN móvil inspeccionadas: texto legible, sin desborde horizontal,
  campos previos deshabilitados y Recargar alcanzable mediante scroll.
- Publicado en Git: `1983733d4be19842a58fcefbc012d5772d5d7e10`, rama
  `claude/loving-lovelace-ptbif7`. Revisión independiente del diff sin hallazgos materiales.
- Despliegue aplazado por el actualizador: `world busy; update deferred`.
  A las 15:36 UTC seguía activo `5da58e9`, una instancia sana, un jugador/socket,
  cero errores y bloqueo desactivado. [Estado comprobado](l03d-public-availability/deployment-pending.json).
  No se forzó desconexión ni reinicio. El timer activo volverá a intentarlo con el
  mundo vacío; falta verificar imagen/revisión y entrada pública del cambio nuevo.
- Primer ensayo de navegador: 16 comprobaciones pasaron; el nuevo QA exigía que el
  botón Recargar de un formulario largo cupiera sin scroll. Se corrigió esa aserción
  para verificar acceso mediante scroll/click, conservando el [registro original](l03d-public-availability/browser/browser-first-attempt.json).

## Estado público observado antes de publicar

A las 15:30 UTC, revisión `5da58e934515812f63365a6f895239db4a2a4dab`,
alpha.50/protocolo 55, una instancia sana y timer activo. Salud/status HTTP200,
Supabase durable con cuentas, cero errores/pendientes/bloqueo. Readiness
SQL025/027/028 devolvió versión 1; `MN_INFERENCE_CATALOG` ausente.
Había un jugador/conexión; no se desconectó ni reinició manualmente.

## Alcance pendiente

La creación, emparejamiento y conexión real del compañero desde una cuenta pública
siguen pendientes. El Studio local y sus pruebas de Brisa no acreditan ese flujo.
El [brief](../briefs/l03d-public-inference-availability.md) define las piezas del
siguiente corte. Esta corrección elimina el formulario engañoso; no habilita compañeros.
