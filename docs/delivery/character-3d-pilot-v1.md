# Piloto 3D de personajes — brief v1

Fecha: 2026-10-08. El autor indicó que el arte alpha «se ve fantástico»; queda aceptado como dirección visual para este piloto. Esto acepta la referencia ilustrada, no una malla 3D, rig, animación ni integración al juego.

## Primer ensayo

Usar `docs/art/source/character-alpha-v1/male-scout-master-v1.png` completo y sin editar como primera entrada de imagen a 3D en Meshy. Es el maestro seleccionado del Explorador. Evaluar una sola salida inicial, de cuerpo vestido y como modelo monolítico de prueba. Revisar silueta, cara, materiales y lectura desde la cámara del juego. La Exploradora queda para después de la revisión de estilo del primer resultado.

Una imagen ilustrada de cámara fija no define la geometría de la espalda, el perfil, la topología ni las piezas separables. Si el servicio necesita más referencias o el resultado no mantiene la silueta, preparar luego entradas más limpias en pose A, frente/perfil/espalda. No inferir modularidad 3D del montaje de capas PNG.

## Adaptación y objetivos provisionales

El modelo generado será una fuente experimental. El trabajo de adaptación y aceptación del rig queda a cargo del responsable principal del juego: conservar el contrato de ejes/unidades y adaptar explícitamente al rig interno de 15 huesos, incluyendo bind, pesos y deformación en poses de reposo/carrera/dash. No sustituir `CharacterView` ni integrar al juego como parte de la prueba del proveedor.

Objetivo provisional para un personaje vestido: 12–20 mil triángulos; materiales compartidos y texturas derivadas de hasta 1024 px en escritorio y 512 px en móvil. Medir el GLB y sus texturas reales antes de decidir reducción o aceptación; estos topes de planificación no son rendimiento móvil comprobado.

Tras aceptar la base 3D, adaptar modularmente cabeza, cabello, barba, prendas y accesorios al rig y a puntos de conexión nombrados. Las piezas de rostro deben ser geometría/material 3D; ojos y cejas raster del kit sirven de guía de diseño, no como tarjetas PNG superpuestas. Evaluar morph targets o geometría facial para expresión si se necesitan. Las prendas deberán ajustarse a ambas bases y ocultar las zonas de cuerpo cubiertas para evitar solapamientos. La base femenina se procesa después de revisar y fijar la dirección de la masculina.

## Proveedores investigados y estado

- **Meshy MCP:** se instaló el paquete oficial [meshy-dev/meshy-mcp-server](https://github.com/meshy-dev/meshy-mcp-server), `@meshy-ai/meshy-mcp-server@0.6.1`, bajo `C:\Users\xxajx\.codex\mcp\meshy`, fuera del checkout, sin ejecutar scripts de instalación. Codex lo tiene habilitado como servidor stdio. Se preservaron los bytes previos de `config.toml` y una copia local de recuperación. El handshake directo pasó y enumeró 24 herramientas, incluidas imagen/múltiples imágenes, remesh, retexture, rig y animate. El chequeo de saldo devuelve `missing-api-key`: falta autenticación. No se ha enviado ninguna imagen ni solicitud de generación. [Recibo](../art/character-3d-pilot-v1/meshy-preflight.json).
- **Tripo MCP/API:** [VAST-AI-Research/tripo-mcp](https://github.com/VAST-AI-Research/tripo-mcp) ofrece un MCP alpha conectado al complemento de Blender. Lee la clave API desde el complemento mediante `get_tripo_apikey`; la lectura de `TRIPO_API_KEY` por entorno aparece comentada en la fuente consultada. Su MCP incluye imagen a modelo, pero no expone las opciones de segmentación/rig de la API. [Tripo confirma](https://www.tripo3d.ai/help/api-plugins/tripo-studiotripo-api) que los créditos de Studio y API son independientes. No se instaló ni probó Tripo.

## Prueba preparada y reproducción

La entrada masculina original mide 1024 × 1536, pesa 1,885,419 bytes y su hash queda en el recibo. Se validó localmente el esquema de `meshy_image_to_3d` con Meshy 7.1, geometría standard, salida GLB, pose T solicitada, remesh triangular objetivo de 15.000 caras, textura 2K, PBR desactivado y `image_enhancement: false`. Se conserva también la malla previa al remesh si el proveedor la produce. El precio documentado para imagen a modelo con textura 2K es **30 créditos**; no se ha consumido ninguno por generación. [Precios oficiales](https://docs.meshy.ai/en/api/pricing).

El objetivo de caras y la pose solicitada son parámetros, no resultados comprobados. Hay que medir el resultado y revisar la conversión de la pose ilustrada a T. Los originales 2K se conservarán; los derivados de runtime seguirán el presupuesto 1024/512 tras revisión. Rig y animaciones son pasos posteriores, sin solicitudes automáticas en este corte.

La clave se configura localmente en `C:\Users\xxajx\.codex\mcp\meshy\.env`, en la línea `MESHY_API_KEY=`, o mediante la variable de entorno homónima. El archivo está fuera del repositorio; no pegar la clave en el chat. El servidor carga ese archivo desde su propio directorio de trabajo. La configuración nueva se carga en la siguiente sesión local de Codex; el handshake de este corte fue una conexión directa de comprobación, no una herramienta incorporada a la conversación actual. [Configuración oficial de Codex](https://developers.openai.com/codex/mcp).

Desde la raíz del repositorio:

```powershell
node tools/character-3d-pilot/meshy-check.mjs
```

Este comando comprueba handshake, catálogo, esquema y saldo; **no puede iniciar generaciones**. `installed-auth-pending` confirma instalación con autenticación pendiente; `ready` exige saldo válido y herramientas necesarias. El recibo se regenera con cada ejecución.

La siguiente evaluación de Meshy debe registrar entrada exacta, opciones usadas, respuesta/errores, formato y métricas de malla/textura, además de una revisión visual en el visor local. El ensayo solo decide si esa ruta produce una base útil; los requisitos de modularidad, rig y aceptación de juego se evalúan aparte.
