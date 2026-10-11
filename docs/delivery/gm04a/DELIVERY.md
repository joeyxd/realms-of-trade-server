# GM04a — multiselección de decoraciones

Fecha: 2026-10-10, hora de México. Estado: **publicado y aceptado en alpha.40/protocolo 47;
release `c4ffc62df90d87b25649728b116a92ca99c6d4a7` sana**. Continúa el
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

El navegador público pasó **19/19**, con entrada real de invitado y sesión GM autenticada mediante
un enlace de un solo uso; se canceló el diálogo sin cambiar la contraseña. Verificó la versión servida
y el protocolo importado por el navegador, las 17 comprobaciones del editor y la ausencia de mutaciones
a los endpoints remotos de borradores/publicación/contenido. El fixture vive solo en IndexedDB de un
contexto nuevo. [Evidencia pública final](public-browser-evidence.json). Se esperó a que terminaran
la transición de entrada y la pantalla de embarque antes de la [captura del invitado](public-guest-gameplay.png).

La [primera sesión pública 19/19](public-night-browser-evidence.json) conserva las capturas reales
del ciclo nocturno; los modelos se veían demasiado oscuros para revisar sus superficies.
[ES nocturno](public-night-selection-es-final.png) · [EN nocturno](public-night-selection-en-desktop.png).
La repetición final conserva la iluminación pública durante las operaciones y usa luz diurna **solo
en el renderer del cliente, fuera del gameplay**, para las tres referencias visuales finales:
[ES](public-selection-es-final.png), [EN](public-selection-en-desktop.png) y
[viewport estrecho](public-selection-en-844x390.png). Todas fueron inspeccionadas. El override queda
registrado en la evidencia y no cambia el reloj, el terreno ni el estado del servidor. No acredita
que la escena pública tenga luz diurna ni mide FPS físicos.

Los [intentos iniciales](public-attempt1.json) y el [diagnóstico de ruta](public-attempt2.json) fallaron
antes de lanzar el navegador por una ruta local de Playwright incorrecta. Se corrigió la ruta del wrapper;
no se cuentan como aceptación. Una [repetición 19/19](public-attempt3.json) aún capturaba al invitado
durante el vuelo de entrada: la aceptación final espera también HUD, controles y cámara asentados.
Los intentos sin obtener el lock del actualizador no iniciaron sesión.

La imagen candidata Linux pasó también **109/109** en los 14 archivos del actualizador; es una
selección solapada con la regresión local, no se suma a las 331. El reemplazo inicial se aplazó
porque volvió a conectarse una partida; después se instaló con el mundo vacío.
[Pruebas de imagen activa](image-updater.json).

La imagen activa corresponde a `c4ffc62df90d87b25649728b116a92ca99c6d4a7`, con health interno sano, HTTP 200,
almacenamiento Supabase y cero errores. El contenido publicado sigue en mapa base, generación
4, con 4 revisiones y 4 recibos retenidos; el canario no cambió ese puntero.
El temporizador del actualizador sigue activo.
[Despliegue comprobado después del navegador](deployment.json). El commit posterior de esta evidencia
solo añade documentación, herramienta QA y capturas; no se cuenta como otra aceptación de runtime.

Siguen las plantillas de conjuntos (GM04 siguiente), materiales y dispersión; el terreno pertenece a GM05.
No se cambió la contraseña ni se guardaron credenciales en los artefactos.
