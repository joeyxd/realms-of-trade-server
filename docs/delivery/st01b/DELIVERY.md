# ST01b — biblioteca original de Niagara

Alpha.66, protocolo 60. Corte publicado y verificado en `739e1b2`.
Continúa el [taller](../../briefs/st01b-niagara-library.md). El taller de UI sigue planificado.

## Qué hay en el taller

El censo por clase de Unreal 5.8 incluye las 993 fuentes NiagaraSystem de los tres proyectos:
7 ActionRPGMultiplayerStart, 756 MyProject y 230 SimpleMultiplayerSurvival. Agrupar hashes
exactos del paquete produce 916 identidades y 77 aliases binarios. Eso no prueba que dos
proyectos tengan las mismas dependencias ni el mismo resultado visual. Se conservan ambos
orígenes. Hay 775 miniaturas originales de paquete; son imágenes estáticas, no conversiones.

La biblioteca completa tiene 932 entradas: Tromba, los 916 sistemas y 15 componentes de
textura con identidad independiente. Hay 17 vistas animadas: Tromba, esos 15 componentes
y un extracto capturado de Firework. Los otros 915 sistemas tienen adaptación pendiente;
ninguna simulación Niagara 3D se ejecuta en el navegador.

Buscar por nombre, familia, proyecto, paquete o hash completo/prefijo de al menos ocho
dígitos; filtrar categoría/proyecto/estado y mostrar más resultados. Los nombres numéricos
no coinciden con todos los hashes. La biblioteca puede abrirse en ambas orientaciones de móvil.
La selección siempre muestra nombre y representación; un sistema pendiente cancela cargas
y bloquea reproducción, controles y guardado sin perder los borradores de otras selecciones.

Cada vista tiene parámetros acotados de tamaño, proporción, duración/velocidad, brillo,
opacidad y tinte. El contrato Tromba v1 permanece exacto, incluido su control de densidad.
Los derivados usan v2; no ofrecen una densidad ficticia. Borrador, historial, recuperación
y guardar/cargar se separan por efecto, cuenta y servidor; JSON estricto de hasta 16 KiB.
«Base del adaptador» compara valores iniciales de la adaptación. No publica habilidades,
ingresa un cuerpo, escribe progreso ni altera combate, costes o cooldowns. Sin SQL nuevo.

## Fidelidad aceptada y pendiente

Los [componentes revisados](../../art/niagara-v1/component-review.json) conservan sus secuencias
completas: 8–64 frames, incluido WaterSplash 7×7/49 y Smoke_1 10×6/60. FlowLoop y Wispy
conservan celdas de 512 px en escritorio. Los taps bicúbicos se limitan a muestras dentro
de cada intervalo UV; se preserva la proporción 64×128 de Lightbeam. Las interpretaciones
de canales se declaran: opacidad original, máscara de luminancia o RGBA original de WaterSpark.
Las máscaras blancas no equivalen a los materiales/colores finales del sistema.

Un mismo humo compartido por 18 sistemas es un componente, no 18 sistemas convertidos.
Las 157 asociaciones aceptadas de 160 candidatas conservan hashes y propietario exacto del renderer;
se corrigieron 101 atribuciones por prefijo. No se acepta la grilla Smoke_1 10×5 que corta
las celdas naturales, ni se reduce GroundFire 11×11/121 a 64 frames para declararlo listo.

[Firework](../../art/niagara-v1/firework-capture-manifest.json) procede de MyProject: 60 frames
reales a 1024², una activación, pasos acumulativos a 60 Hz y lectura en pausa, muestras
cada 1/30 s entre 0 y 1,9667 s. Automatización Unreal terminada con éxito; hash original
exacto, calibración de 17.417 píxeles y ambas capas verificadas como aditivas. Encuadre
común sin recortes de la secuencia; RGB original y alfa derivado para ese blending.
La recomposición sobre negro tiene error máximo 0,00518 y medio 0,0000362 en canales lineales.
Conserva exposición/tonemapping del fixture; preroll absoluto y semilla no verificados.
Es un extracto 2D de una cámara, con duración limitada y sin profundidad/oclusión; no acepta
el ciclo completo ni equivalencia visual de las dependencias de su alias en otro proyecto.

Las anteriores capturas de Impact Wood con reinicio por frame fueron retiradas. Los
200 frames diagnósticos de ocho sistemas no se registraron: materiales mixtos, contextos
y la salida de automatización requieren otra aceptación. El análisis HDR demostró que
reconstruir humo/translucencia como aditivo perdería comportamiento sobre fondos claros.
No se sustituyeron por presets parecidos.

La meta de conservar calidad original continúa en el [plan de adaptación 3D](../../briefs/st01c-niagara-native-fidelity.md):
emisores, texturas, materiales/canales, capas y movimiento originales, referencia desde
varias cámaras y cantidades extraídas antes de habilitar parámetros de partículas.
Ese plan no está implementado ni aceptado por esta entrega. Las fuentes de `C:\Unreal`
permanecen de solo lectura; capturas fallidas, originales y frames completos quedan en scratch.

## Evidencia y coste

[CPU](cpu.json): 58/58 en ocho archivos pertinentes, incluido acceso GM, cuentas,
recursos funcionales, walkthrough y conservación del renderer/Tromba. [Auditoría](final-audit.json)
y [herramientas](tool-quality.json) comprueban catálogo, asociación de fuentes, hashes,
límites previos a decodificación y recursos empaquetados. No se repitió la suite general.

[Chrome local](accepted-local/browser.json): 9/9, con las 32 variantes reales de escritorio/móvil,
borradores/historial/recuperación, cancelación, búsqueda, ES/EN, 844×390 y 390×844 y foco
de teclado en biblioteca/diálogo. Cero errores de render, escrituras GM y acciones de juego;
el cliente sigue sin ingresar. CDN de Three.js/GSAP servido desde copias locales durante QA.
Capturas inspeccionadas: [agua](accepted-local/component-26e09bd0f93cb620-7x7-luma-desktop.png),
[Firework](accepted-local/niagara-b23e30580f0f5d09-desktop.png),
[pendiente horizontal](accepted-local/niagara-pending-844x390.png) y
[vertical EN](accepted-local/niagara-library-en-mobile.png).

Los 16 pares de atlas pesan 11.374.120 B en escritorio y 2.394.300 B en móvil.
Una variante por selección, carga diferida y liberación al cambiar/cerrar. Máximo 4096²
en escritorio y 1024² en móvil; esos límites y la emulación no prueban FPS en un teléfono.
No se publica una variante del mundo ni cambia la autoridad de guardado.

## Publicación

El actualizador habitual publicó `739e1b2bb55b4d74592d3d2b04c9b870c7de47ac` en la única
autoridad existente: imagen `marea-negra:alpha-739e1b2bb55b`, contenedor sano.
[Actualizador](updater.json): 197/197, cero fallos y marcador de revisión/imagen validado.
[Runtime público](public-runtime.json): los 11 archivos cambiados de runtime/paquete
coinciden con los bytes de Git; los 32 atlas públicos responden 200 y coinciden con Git
y sus manifiestos. `/`, `/health` y `/status` responden 200; alpha.66 y mundo listo.

[Chrome público con cuenta GM](public/browser.json): 9/9, las 32 variantes reproducidas,
sin errores, escrituras GM ni acciones de gameplay; el cliente no ingresa al mundo.
Revisión visual de [Firework](public/niagara-b23e30580f0f5d09-desktop.png),
[agua](public/component-26e09bd0f93cb620-7x7-luma-desktop.png),
[pendiente horizontal](public/niagara-pending-844x390.png) y
[vertical EN](public/niagara-library-en-mobile.png). Three.js/GSAP se suministraron desde
copias locales durante QA; esto no verifica disponibilidad externa de esos CDN.

[Entrada normal](public-entry.json): invitado por WSS con Origin y generación de contenido
vigentes; bienvenida/protocolo 60, perfil y snapshot recibidos, conexión cerrada.
Sin input ni comandos; al cerrar hay cero jugadores, sockets, errores de servidor/almacén
y guardados pendientes. El primer fixture sin Origin recibió el rechazo 403 esperado;
el segundo sin generación vigente no ingresó. Se corrigió el fixture, no el guard del servidor.
No hay nueva migración, configuración ni autoridad. `/status` no expone el estado de drenaje;
no se deduce de esta evidencia una aceptación de recuperación M5 o rendimiento físico.

Esta aceptación cubre ST01b: catálogo y vistas declaradas. Los 915 sistemas restantes
siguen pendientes y ST01c conserva su estado de propuesta; no se acepta equivalencia AAA/3D.
