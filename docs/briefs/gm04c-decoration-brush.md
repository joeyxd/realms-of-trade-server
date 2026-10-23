# GM04c — dispersión decorativa con coste visible

Siguiente corte autorizado tras GM05b. El autor construye dentro del juego y conserva borradores privados.

## Resultado y límites

Elegir un modelo preparado en Biblioteca y abrir Dispersión. Arrastrar sobre suelo seco para previsualizar
copias con pincel circular, cuadrado o elíptico, radio, suavidad, giro del pincel, separación mínima,
densidad, semilla y rango de escala. Giro de cada copia aleatorio alrededor de Y. Soltar conserva el trazo
completo; Escape, pérdida de foco y pointercancel lo descartan. Un deshacer revierte todo el trazo.
Las copias son decoraciones normales independientes, seleccionables y persistentes con IDs propios.

No añade nodos recolectables: una palma decorativa se identifica claramente como no talable. El adaptador
de recursos será otro corte. No crea terreno, no cambia el generador/RNG, recursos, colliders o economía.
Conserva documento v2–v4, compiler 2 y SQL033; guardado/preparación/activación existentes.

## Reutilización y presupuesto

Consultar los candidatos concretos Unreal/FAB y los modelos web actuales; registrar el resultado en la entrega.
Reutilizar vegetación web y roca/coral derivados existentes sin regenerar ni alterar fuentes. No nueva dependencia.
Mostrar bytes del archivo seleccionado, ahorro respecto al original cuando exista recibo, triángulos por copia,
geometría/materiales compartidos, texturas realmente cargadas y estimación RGBA8 con mipmaps por modelo único.
La cifra de archivo no representa memoria GPU. WebP reduce transporte; esta entrega no incorpora KTX2 ni LOD.

Medir geometría y primitivas del modelo ya preparado; no confiar en métricas declaradas para los límites.
Cada gesto admite como máximo 120 copias, 250.000 triángulos y 256 primitivas visibles (antes de sombras/outline),
y hasta 1.000 cambios totales publicados. Las adiciones del borrador completo quedan limitadas a 1.000.000
triángulos y 1.024 primitivas medidas; no incluye el mapa base ni pases extra de sombras/contornos.
Rechazar todo el gesto al exceder un límite; nunca truncar silenciosamente.
Compartir geometría/materiales existentes; sin prometer instancing, sectores/LOD ni FPS de teléfono.

## Contrato de muestreo

Semilla local explícita, sin consumir RNG del mundo. Rejilla con jitter sembrado y selección por peso de pincel,
repetible para la misma trayectoria/semilla/parámetros. Resample y candidatos acotados; espaciamiento mínimo
contra todas las decoraciones añadidas y puntos de este gesto. Preview y resultado usan los mismos IDs de gesto.
Omitir muestras no permitidas de manera determinista y mostrar cuántas se omiten. Proteger la huella horizontal
del modelo a escala máxima: costa/agua, caminos, pendientes, servicios, dock, arena/volcán/PvP y recursos.
No ocupar huecos protegidos con decoración visual sin colisión. Cero puntos válidos no produce historial.

## Aceptación

Pruebas puras de reproducibilidad, formas, separación, exclusión, costes, límites y atomicidad; roundtrip de
documento y preparación con hashes existentes. Pruebas de interacción para cancelación y un solo undo/redo.
Navegador local ES/EN escritorio y móvil emulado: modelo real, textura cargada, preview, colocación, cancelación,
deshacer/rehacer, guardar/reabrir y errores. Capturas inspeccionadas. Publicar solo después de revisar el corte;
verificar revisión activa, salud, entrada real y navegador autenticado. No activar un mapa de ensayo en esta entrega.
