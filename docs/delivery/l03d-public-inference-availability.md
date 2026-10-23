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
runtime. No hubo llamadas al modelo ni cambios en las credenciales, cuotas o configuración
de los jugadores. El cierre público usa una cuenta temporal de aceptación con retirada explícita.

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
- Despliegue inicialmente aplazado por el actualizador: `world busy; update deferred`.
  A las 15:36 UTC seguía activo `5da58e9`, una instancia sana, un jugador/socket,
  cero errores y bloqueo desactivado. [Estado comprobado](l03d-public-availability/deployment-pending.json).
  No se forzó desconexión ni reinicio. El autor cerró su pestaña y el relevo se completó.
- Desplegado y comprobado a las 16:16 UTC en `6fd7f686fa038613e8174e2f3169fee4cae797c1`
  (incluye `1983733` y `2331b37`), alpha.51/protocolo 55. Una instancia sana, timer activo,
  salud/status HTTP200, Supabase durable, cero errores/pendientes/bloqueo. Seis módulos de
  compañeros, centro, clientes y versión coinciden entre Git, imagen y URLs públicas.
  [Imagen/revisión/readiness](l03d-public-availability/deployment.json).
- Entrada pública real de invitado: 7/7, cero errores, ES/EN y viewports escritorio/móvil.
  [Evidencia](l03d-public-availability/public/public-browser.json). Capturas inspeccionadas.
  El primer ensayo encontró una aserción antigua que esperaba otra copia introductoria;
  se actualizó para comprobar la preparación de límites y el centro bloqueado para invitados.
  [Registro original](l03d-public-availability/public/public-browser-first-attempt.json).
- Entrada pública autenticada real: 7/7, cero errores de página o runtime, sin auth ni
  respuestas simuladas. La cuenta temporal entró sin perfil sembrado: el host creó su
  perfil ordinario. Centro durable con revisión 0, configuración nula, cero conexiones
  y personajes; gasto/Guardar ocultos, Volver/Recargar operables. ES escritorio y EN
  390×844 sin desborde horizontal; capturas inspeccionadas. Se cerró su propio socket,
  se esperaron tres lecturas estables del perfil y cero escrituras u operaciones económicas
  pendientes, y se retiraron y comprobaron el perfil y usuario temporal.
  [Aceptación final](l03d-public-availability/authenticated-final-accepted/acceptance.json).
  No se guardó configuración de inferencia ni se llamó a un proveedor.
  La revisión independiente detectó que un cierre podía diferirse por trabajo económico;
  el QA exige también `economic.pending === 0` y registra esa barrera antes de borrar.
  [Ensayo previo también aprobado](l03d-public-availability/authenticated-accepted/acceptance.json).
- Los dos ensayos autenticados anteriores conservan sus fallos de QA: selector ambiguo
  y señal de cierre perdida al cerrar el contexto, después carga de navegador agotada.
  Se corrigieron el selector y cierre observable con página viva; Chrome usa las mismas
  opciones WebGL que el canario público existente. Ambas cuentas temporales quedaron
  retiradas con verificación explícita antes del ensayo aceptado:
  [primera recuperación](l03d-public-availability/authenticated/cleanup-recovery.json),
  [segunda recuperación](l03d-public-availability/authenticated-final/cleanup-recovery.json).
- Cierre a las 16:35 UTC: salud HTTP200, alpha.51, cero jugadores/sockets, errores,
  perfiles pendientes u operaciones económicas; Supabase durable y sin bloqueo.
  [Estado final](l03d-public-availability/public-final-status.json).
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
