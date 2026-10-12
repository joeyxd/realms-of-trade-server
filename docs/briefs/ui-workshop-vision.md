# Taller futuro de interfaz

**Estado: propuesta de diseño; no implementado ni desplegado.** Este brief prepara una futura herramienta de autoría de UI para MAREA NEGRA. No cambia el corte activo: el siguiente trabajo autorizado sigue siendo el Taller de habilidades (ST01), que ajusta primero habilidades actuales e incluye una adaptación real de Niagara. Este taller de UI es posterior y no debe desplazar ni mezclar su alcance.

## Objetivo

Permitir que una persona autorizada vea una pantalla real del juego, seleccione sus elementos y ajuste su posición, tamaño y arte dentro de límites seguros. Debe poder probar estados y traducciones sobre una vista del juego, guardar un borrador privado y comparar el resultado antes de una publicación explícita con rollback. La edición de interfaz no cambia permisos, reglas, daño, economía ni estado de cuenta.

Hay dos resultados distintos y deben tener controles separados:

- **Autoría de interfaz del juego:** edita una revisión compartida del diseño que, tras revisión y publicación, puede llegar a los jugadores. Requiere permiso de autor/GM y publicación deliberada.
- **Distribución personal de elementos del HUD:** permite mover o redimensionar los elementos que el juego declare personalizables para esa persona. Se guarda como preferencia privada de usuario/dispositivo, no cambia el diseño compartido y no pasa por publicación global.

El primer corte debe entregar un alcance pequeño y útil: inspeccionar una pantalla existente, seleccionar, mover, redimensionar, fijar posición y restablecer uno o más elementos, y previsualizar su arte/estados. No es un editor general de DOM/CSS ni de código. Elementos estructurales, críticos o no declarados quedan bloqueados hasta que tengan un contrato explícito.

## Base existente y límites de reutilización

El editor GM de mundo ya aporta una estructura de referencia: `src/editor/editor.js` construye una herramienta superpuesta, `src/editor/editor.css` define barra y espacio de trabajo, biblioteca/escena/inspector; el árbol permite selección múltiple y `selectionBounds` dibuja una caja para grupos; `TransformControls` y campos numéricos editan transformaciones; `snapStep` controla el ajuste; historial permite deshacer y rehacer. `src/editor/remotePanel.js` ya separa borrador online de publicación, ofrece exportación y resuelve conflictos/revisiones. Se pueden reutilizar sus patrones de interacción y separación de estados, no acoplar el taller a la edición de terreno/props ni asumir que el guardado GM existente sirve para preferencias personales.

La UI real es HTML/CSS por módulos y estado JS, no un lienzo único. `index.html` monta raíces DOM; `styles/vars.css` contiene tokens de color, tipografía, escala y safe area; `styles/hud.css`, `styles/panels.css`, `styles/workshop.css` y estilos especializados cubren HUD, paneles y talleres. `src/ui/**` renderiza estado en DOM y conecta eventos; los módulos de pantalla suelen tener cadenas ES/EN locales. El nuevo taller necesita un registro de elementos editables que conecte esos nodos con claves estables y variables de estilo acotadas. No debe persistir selectores DOM, CSS libre, HTML ni scripts: esos identificadores cambian y permitir CSS arbitrario vuelve frágiles las pantallas y la seguridad.

El editor actual del mundo ya es una buena fuente de tácticas, pero revela problemas que habrá que diseñar expresamente para UI: en escritorio ofrece tres columnas (`.gm-workspace`) y en anchuras menores reorganiza u oculta controles; su marco ocupa toda la pantalla. El nuevo modo debe mantener un lienzo legible, estar limitado por el viewport real y ofrecer herramientas usables sin ratón. El `F4` de depuración no constituye autorización de publicación.

## Experiencia de edición

### Ver y seleccionar

La persona elige una pantalla y un contexto de prueba desde un catálogo, por ejemplo HUD de aventura, inventario, mapa, taller de carpintería o panel de habilidades. El centro muestra la interfaz real renderizada con datos fixture controlados; los paneles de selección e inspector rodean ese preview. La selección en el preview resalta el elemento con un contorno visible y manejadores externos, sin alterar su aspecto de juego. Un resaltado adicional en el árbol/nombre y un anuncio accesible identifican la selección; el color por sí solo no es suficiente.

La selección debe funcionar con puntero, teclado y toque. Un árbol jerárquico/lista permite seleccionar elementos pequeños o solapados, buscar por nombre, alternar visibilidad solo en el preview y seleccionar grupo cuando el registro declare que es seguro. El grupo informa cuántos elementos abarca. Los elementos anclados al mundo, mensajes efímeros, menús modales y zonas de control se marcan como no seleccionables salvo que una pantalla implemente expresamente su modo de edición.

### Posición, tamaño y anclajes

Cada elemento inscrito expone una caja de diseño relativa al viewport y una clave semántica estable. El inspector enseña posición y dimensiones en unidades CSS/píxeles de referencia, además de anclaje horizontal/vertical. Se puede:

- Arrastrar para mover; las coordenadas se convierten a la escala de referencia y se limitan al área segura.
- Arrastrar manejadores de esquina para cambiar ancho/alto, con proporción bloqueada por defecto en iconos/arte cuadrado; controles numéricos permiten ajuste preciso.
- Elegir anclajes de borde/esquina/centro y configurar margen; al cambiar orientación, tamaño o idioma, el elemento conserva su relación al anclaje.
- Definir paso de rejilla, activar/desactivar snap y alinear/bloquear centro, bordes, separación y safe area. La vista muestra guías y una medición legible durante el arrastre.
- Deshacer/rehacer, cancelar el gesto, restablecer el elemento y restablecer pantalla. Restablecer siempre afecta el borrador visible y presenta alcance claro; no publica.

Los valores se validan contra mínimos/máximos del contrato por componente y límites de pantalla. Para tipos compatibles, se conserva el aspect ratio; para texto, el ajuste expone ancho y escala/tamaño tipográfico con límites definidos, no estiramiento libre. Cambiar una caja no debe interceptar por accidente controles vecinos, recortar etiquetas esenciales ni poner objetivos táctiles bajo el tamaño mínimo establecido.

### Arte, estados y variantes

El inspector permite sustituir solo recursos declarados por el componente: icono/imagen, color de acento, fondo/borde, tipografía o preset de tamaño. Antes de aceptar un recurso se enseña en contexto y en su tamaño final, con contraste y recorte visibles. El registro restringe fuente de recurso, MIME/dimensiones/peso, hash y revisión. Una imagen no reemplaza silenciosamente un control semántico ni elimina su etiqueta accesible.

La vista previa tiene selector de estado, por ejemplo normal, foco de teclado, pulsado, deshabilitado, seleccionado, enfriamiento, alerta y carga; solo se ofrecen los estados aplicables al elemento. También ofrece ES/EN, datos cortos y largos, números grandes, texto vacío/lleno y errores. Una tabla de variantes permite inspeccionar resoluciones y orientaciones comunes. El autor puede crear presets visuales nombrados si la pantalla los admite, pero no modificar comportamiento del estado desde el taller.

### Vista responsive y de juego

El canvas permite cambiar entre perfiles de viewport de referencia y rotación. Debe probar escritorio, móvil vertical y horizontal, los puntos de quiebre actuales y safe area. La UI existente ya usa `--safe-t/b/l/r`, adapta HUD mediante container queries y tiene estados táctiles en `styles/hud.css`; el preview debe consumir el mismo viewport/safe-area, no estimar solo desde el tamaño de ventana del navegador.

El modo preview incluye una simulación visual aislada con fixtures: avatar, conteos, vida/recursos, cooldown, lista larga, invitación/error y texto bilingüe. Se bloquean interacciones de juego y red, no se consumen recursos y no se guardan progresos. El botón «Ver en partida privada» será un modo separado y explícito de solo lectura, ejecutado con cuenta/entorno autorizado, para contrastar el render real; nunca publica ni concede autoridad por abrir el preview.

## Contrato de datos y protección

Cada componente editable necesita un descriptor con: ID estable y versión; pantalla/elemento; modos personales y de autoría admitidos; caja por breakpoint y anclaje; límites de dimensión/posición; recursos permitidos y fallback; textos/estados localizados; reglas de accesibilidad; prioridades de colisión/capa; migración y base de restablecimiento. Los componentes no inscritos permanecen fuera del editor.

El borrador debe guardar exclusivamente overrides validados por ID y versión del componente, revisión base y metadatos de autoría. Rechazar IDs desconocidos, valores no finitos, dimensiones fuera de rango, tipos incompatibles, recursos que exceden el contrato y documentos sobre una base que ya cambió. Mantener fallback del diseño base al cargar; un borrador corrupto o recurso ausente no debe dejar la UI invisible ni perder la copia recuperable.

Los borradores de autoría son privados al principio. Guardar localmente, exportar/importar una copia validada y comparar base/borrador son acciones separadas. Si se añade servicio compartido, el guardado online sigue siendo solo borrador privado por autor y revisión; no hace efectivo el cambio para jugadores. La publicación requiere informe de compatibilidad, autenticación con rol específico, revisión visible, confirmación explícita, revisión inmutable y artefacto exportable. Rollback crea/apunta a una revisión anterior de forma explícita y auditable. Las preferencias personales pueden guardarse separadamente por usuario/dispositivo, con restauración a valores predeterminados, y jamás entran al canal de publicación global.

La autoría debe distinguir la capa visual de acciones funcionales. Mover un botón no modifica su destino, permisos ni petición al servidor. Bloquear la edición de controles sensibles y validar la matriz de acciones/pruebas antes de publicar.

## Accesibilidad y captura de entrada

Conservar semántica, roles, nombres accesibles, orden de foco y estados ARIA del elemento. El editor ofrece navegación completa por teclado, foco visible, etiquetas numéricas, anuncio de coordenadas y dimensiones, contraste suficiente y compatibilidad con movimiento reducido. El contorno de selección debe contrastar con fondos claros y oscuros, y los controles no dependen exclusivamente de color.

Los gestos de edición usan pointer capture y tienen cancelación determinista en Escape, cancelación del puntero, pérdida de foco, cierre del taller y cambio de pantalla. Mientras el puntero está sobre el canvas del editor, las entradas no deben activar movimiento, ataque, cámara, drag-to-aim ni controles táctiles del juego. Los campos consumen teclas de juego y conservan selección/edición de texto. En táctil, mover requiere un modo/herramienta de edición dedicado para evitar confundir scroll, tap de juego y arrastre; el preview también ofrece acciones de inspector como alternativa al gesto. Cerrar/liberar el taller restaura listeners, foco y captura sin dejar controles de juego atascados.

## Inventario acotado Unreal/FAB

Los inventarios existentes ya registran referencias de UI de `ActionRPGStarterSystem/InventorySystem` y `Widgets/Images/ItemImages`/`Skills/Images`, descritas como esquemas/flujo y posibles iconos raster exportables. El informe indica que los widgets UMG requieren UI propia; los nombres de archivos no verifican apariencia final, estructura funcional, exportabilidad ni encaje con el HUD actual. No aparece un widget listo que se pueda ejecutar o importar al navegador. El inventario de `C:\Unreal` es una referencia ya existente, no una invitación a escanearlo de nuevo.

Para este taller la ruta principal es mantener el sistema HTML/CSS actual. Si más adelante se elige un icono concreto, confirmar el archivo, alpha, recorte, lectura al tamaño real, formato, procedencia y coste; importar un derivado al pipeline del proyecto y conservar su fallback. UMG/Blueprint se usan solo como referencia visual/flujo y se reconstruyen en componentes del juego. Ningún asset candidato está aprobado como parte de este brief.

## Etapas futuras

1. **UIW01 — contrato y prototipo local.** Elegir una pantalla de bajo riesgo y declarar sus componentes editables, tokens, estados y fixtures. Construir selección/contorno, inspector numérico, mover/redimensionar, anclajes, rejilla, undo/reset y previsualización, con base y borrador local. Mantener el modo personal como experimento separado de autoría.
2. **UIW02 — arte y matriz responsive.** Añadir reemplazo de recursos permitidos, variantes visuales, ES/EN, estados, perfiles escritorio/móvil/orientación y revisión de accesibilidad. Decidir desde evidencia si el primer alcance se centra en layout global del HUD, en perfiles personales o en ambos.
3. **UIW03 — borradores y publicación controlada.** Exportación validada, guardado privado remoto, revisión/compatibilidad por componente, permiso explícito de autoría, revisiones inmutables y rollback. Cerrar almacenamiento y autorización en un contrato separado antes de tocar SQL o servicio.
4. **UIW04 — adopción gradual.** Incorporar otras pantallas por descriptor, empezar por paneles sin consecuencias de juego, vigilar migración de IDs y mantener un inventario de elementos excluidos hasta que cumplan su contrato.

## Criterios de aceptación antes de activar una revisión

- Seleccionar el mismo elemento desde preview, lista y teclado; contorno y nombre coinciden, sin ejecutar la acción del juego.
- Mover y redimensionar con puntero/toque/valores numéricos, snap configurable, anclajes, cancelación, undo/redo y reset; los límites y proporciones son correctos.
- La caja conserva su anclaje al cambiar viewport/orientación/idioma, respeta safe areas y deja legible el contenido en los perfiles soportados.
- Arte y estados muestran fallback, texto accesible y ES/EN; el elemento sigue operable con teclado y lector de pantalla.
- Preview y personalización no envían comandos de gameplay ni consumen/recompensan nada; autoría no cambia comportamiento del control.
- El borrador soporta cerrar/abrir, exportar/importar validado y fallo/recurso inválido sin pérdida; las preferencias personales y el draft global no se mezclan.
- Guardar borrador no publica; usuario sin rol no puede publicar; publicar y rollback señalan exactamente la revisión efectiva, con historial y posibilidad probada de revertir.
- Capturas revisadas de escritorio, móvil vertical y horizontal en ES/EN, en estados representativos; se inspeccionan errores de consola y recortes. La emulación no acredita ergonomía ni rendimiento en dispositivo físico.

## Decisiones pendientes

Antes de UIW01, elegir la pantalla inicial, los viewports de referencia, qué preferencias personales son realmente deseables y si su persistencia será local o sincronizada por cuenta. Antes de UIW03, definir rol exacto de publicación, fuente de revisiones compartidas, migración del catálogo y compatibilidad cliente/servidor. También queda por decidir si «cambiar arte» incluye iconos cargados por usuario en el primer prototipo o solo selección de recursos ya registrados.
