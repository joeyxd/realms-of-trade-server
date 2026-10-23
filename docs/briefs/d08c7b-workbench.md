# D08c.7b — banco de materiales con tandas

Fecha: 2026-10-08. Continúa el recorrido de recursos y construcción D08c.7 mientras arte
prepara Salty Shore. La carpintería comunitaria A1 requiere primero un contrato atómico
entre inventario del personaje, proyecto del pueblo y recibo; los guardados actuales de
perfil y mundo son independientes. Este corte mejora el banco real del juego.

## Alcance

F / Preparar abre un panel junto al banco existente. Muestra la receta actual de madera,
troncos disponibles, cantidad elegida y volumen de mochila antes/después. Preparación
de 1 a `HARVEST.craftMax` (10 inicialmente), con botones 1, 3 y máximo disponible.
La madera preparada paga las piezas y reparaciones existentes de la balsa.
Sin receta nueva, precio, proyecto compartido ni campo de aprendizaje en el perfil.

El comando `resource/craft` admite `n` entero positivo opcional; omitido equivale a 1.
Un lote consume y produce completo, incrementa una sola revisión y usa un solo cooldown.
Cantidad forma parte de la identidad del recibo. Ninguna concesión optimista del cliente.
Validación/preflight antes de aplicar; replay exacto devuelve el resultado existente.

Cerrar/reabrir conserva la solicitud pendiente. Tras cinco segundos se puede reintentar
el mismo comando/ID; confirmación exige el ack correspondiente y la revisión de perfil.
Alejarse cierra el panel y conserva la solicitud; el prompt vuelve junto al banco.
Entrada en otra partida limpia el estado de UI. Recibos siguen siendo de sesión.

## Reutilización comprobada

Auditoría concreta de GPT-6 Luna: banco procedural S19 (`townWorkbenchGeometry`, ~284
triángulos) y material/atlas de madera S14 ya se renderizan mediante `ResourceNodes`.
`prop:storage-crate` GLB registrado (~51,7 KB/204 triángulos) está disponible, pero no hace
falta para este panel. S18 `townSign` puede servir para A1; no se crea todavía un tablero.

Unreal `SM_RepairBench` (~101.896 B) y hut (~70.989 B) son fuentes `.uasset`, sin GLB,
pivotes ni presupuesto móvil verificados. Reutilizar el banco runtime evita exportar o
recrear su arte. Fuentes Unreal, terreno, props y manifiesto permanecen fuera del corte.
UI en CSS/texto con paleta madera/dorado/turquesa; cero texturas/modelos nuevos.

## Aceptación

- Lote exacto y replay; reutilizar ID con otra cantidad se rechaza.
- Falta de materiales, capacidad, revisión, calma, vida, distancia y preflight sin pérdidas.
- Catálogo real: dos troncos y una piedra ocupan 8/10; preparar dos deja piedra y dos maderas.
- Guardado firmado/reentrada conserva bienes, oro y revisión; sigue el contrato guest existente.
- Escritorio, móvil horizontal y vertical rotado: controles reales F/touch, panel dentro de
  pantalla, confirmación desactivada sin materiales y recuperación de ack perdido.
- Capturas inspeccionadas y pruebas pertinentes. Hosts locales aislados; sin `.env`, SQL,
  servicios externos, publicación ni afirmaciones de FPS/dispositivo físico.

Principal: protocolo, entrypoint, integración, QA y aceptación. GPT-6 Luna: inventario
concreto, panel aislado, pruebas de autoridad y revisión independiente. Un escritor por archivo.
