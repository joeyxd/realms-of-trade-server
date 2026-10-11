# GM04a — multiselección de decoraciones

Fecha: 2026-10-10, hora de México. Estado: **integrado en alpha.40/protocolo 47 y aceptado localmente;
despliegue público pendiente**. Continúa el
[contrato previo a código](../../briefs/gm04a-multiselection.md) y los borradores de
[GM03b2](../gm03b2/DELIVERY.md).

En **Escena**, marca las casillas o usa Shift+clic para seleccionar hasta 120 decoraciones visibles.
También funciona Shift+clic sobre el mapa. El pivote común permite mover, girar y escalar el conjunto;
F lo encuadra. Duplicar crea copias con IDs independientes. Eliminar quita las decoraciones añadidas
y oculta las bases seleccionadas. Cada operación se deshace o rehace completa en un paso.
**Apoyar en terreno** proyecta cada origen. Escape o perder foco cancela el arrastre completo.

La selección dura solo durante la edición. El inspector aplica giros y escala desde la disposición
actual y reinicia esos deltas a 0/1 tras confirmar. Los objetos ocultos se restauran individualmente;
la colisión se configura individualmente. Los límites se validan para todo el lote: si una copia
sale del mapa o falta capacidad, se rechaza la operación completa, sin deformar la formación.

El documento sigue en v2, con instancias y overrides ordinarios. Guardado local, recuperación,
CAS remoto, preparación, hashes, activación y rollback conservan sus contratos. No hay SQL nuevo,
estado de perfil, jerarquías persistentes ni cambios de autoridad. Los prefabs y el terreno siguen
para otros cortes.

Se reutilizan la caja integrada desde Unreal/FAB y los restos de playa ya optimizados. La caja tiene
204 triángulos y ocupa 51.684 B; los tres restos suman 436 triángulos y 18.740 B, sin texturas nuevas.
No se alteraron las fuentes ni se añadieron originales 2K/4K al bundle. Ver la decisión de reutilización
y las fuentes en el [brief](../../briefs/gm04a-multiselection.md).

La aceptación local de navegador pasó **17/17 en alpha.39/protocolo 46**, antes de integrar el
purificador naval de upstream, con autenticación simulada: modelos reales,
casillas/teclado, arrastre del gizmo con puntero, calidad baja/alta, giro XYZ y escala, cancelación
mixta con restauración exacta de matrices instanciadas, duplicar/eliminar con undo, caminar y volver,
guardado/reapertura, ES/EN y pantalla 844×390. No conecta el fixture al gameplay ni escribe borradores
remotos. [Evidencia local](local-browser-evidence.json). Capturas inspeccionadas:
[ES](local-selection-es-final.png), [EN](local-selection-en-desktop.png) y
[viewport estrecho](local-selection-en-844x390.png). No acredita rendimiento físico móvil.

El primer intento de regresión encontró un test de mochila que aún esperaba la capacidad legacy
en un perfil starter y un fallo EPERM de limpieza del fixture PC en Windows. Se corrigió únicamente
el fixture de economía para comprobar ambas capacidades aprobadas; el test PC pasó al repetirse.
La evidencia original se conserva en [regresión anterior](regression-before-fix.json).

Una repetición se quedó bloqueada en `gm-content-check` en Windows; se detuvo únicamente ese
árbol de procesos y no se cuenta como resultado. [Intento detenido](preintegration-hang.json).
La integración final alpha.40/protocolo 47 pasó **329/329 en 52 archivos**, incluidos GM, host,
economía, taller, natación y las tres suites nuevas del purificador. El checker aislado pasó
**2/2**: en total, **331/331 en 53 archivos** repartidos entre ambas particiones, sin solapamiento.
[Integración y comando](integration.json) · [checker](checker.json).

La publicación solo se aceptará tras comprobar la revisión de la imagen activa, salud pública,
entrada real y sesión GM autenticada. El canario de este corte usa un contexto nuevo de navegador
y un borrador local privado: no registra ni activa revisiones ni modifica el borrador remoto existente.
