# S10 — algas someras pintadas

Fecha: 2026-10-07. Integración local de tres formas de alga en las posiciones submarinas existentes: cintas arqueadas verdes, hojas bifurcadas turquesa y abanicos bajos ocres. Sustituyen la mata básica anterior. El pasto costero ya corresponde a S08; este corte completa la parte submarina de la fila `hierbas-algas` y no añade hierbas terrestres.

## Resultado y reutilización

Se revisó el inventario Unreal y tres candidatos concretos Orasot; sus rutas y tamaños están en el [brief S10](../briefs/visual-s10-seaweed.md). Sand Rocket es configuración de hierba; las dos mallas genéricas de vegetación no tienen aspecto/dependencias submarinas verificados. No se encontró una alga portable revisada que mejore la base actual. Se conserva la construcción nativa de cintas curvas y flexión, ampliada con crestas, bordes oscuros, tres paletas y dos niveles de detalle. Fuentes Unreal intactas, sin exportación ni auditoría de licencias.

| Forma | Triángulos cerca | Triángulos lejos | Matas en la isla |
|---|---:|---:|---:|
| Cintas arqueadas | 60 | 16 | 58 |
| Bifurcada | 84 | 16 | 62 |
| Abanico bajo | 72 | 16 | 77 |

La semilla `99282957` conserva **197 de las 216 posiciones originales** después de comprobar fondo, inclinación, planitud y despeje del muelle. El primer filtro de pendiente 0,35, adecuado para plantas terrestres, descartaba todas: la pendiente mínima medida era aproximadamente 0,408. El límite submarino es ahora 1,4; las hojas siguen la normal del fondo y ocho muestras detectan cambios bruscos. La escala conservadora cubre inclinación y oscilación, manteniendo la punta debajo de −0,4 m. No cambia el heightfield, las posiciones originales, colisiones, RNG ni comportamiento del barco.

Un material toon opaco compartido, pintura por vértice y nervadura suavizada por derivadas. Las normales son geométricas; no se requieren mapas de normal, imágenes ni GLB adicionales. La flexión tiene raíz fija y punta móvil, usando el reloj de render existente. Sin sombra propia ni pase de contorno en estas piezas pequeñas; reciben la iluminación común y aparecen tras el agua del renderer existente.

## Coste y calidad

Instancias en celdas de 24 m, tres formas y dos geometrías por forma. Actualización de matrices cuando cambia calidad o el foco se desplaza dos metros. High/ultra hasta 256 matas, 65 m y geometría cercana a 22 m; medium o móvil hasta 160, 45 m y cercana a 14 m; low hasta 96, 32 m y todo reducido. Los límites conservan un subconjunto estable y no crean materiales/geometrías al cambiar calidad.

| Vista real: foco (116,89; 95,85) | Activas antes del frustum | Triángulos antes del frustum | Llamadas extra medidas | Triángulos extra medidos |
|---|---:|---:|---:|---:|
| PC high | 40 | 1.248 | 4 | 684 |
| Móvil emulado medium | 23 | 840 | 7 | 696 |
| Low móvil emulado | 5 | 80 | 4 | 80 |

Comparación de grupo activado/desactivado con la misma cámara y todos los pases. La relación de aspecto móvil muestra más grupos que PC; esas llamadas no comparan velocidad entre equipos. Son contadores de geometría, no FPS en teléfono físico.

## Verificación y evidencia

**83/83 pruebas pertinentes**, 14 archivos, sin omisiones. Seis pruebas S10 cubren geometría finita y no degenerada, normales/UV/flexión, posiciones existentes y determinismo, despejes/planitud/sumersión, cap real de 256 y duplicados, presupuestos, recursos compartidos y LOD. La regresión incluye S01–S09 y el catálogo.

Cuatro contextos nuevos de navegador: PC high, móvil emulado medium, low y `noassets`. Cero errores JS de juego, cero error GL y programas enlazados; el favicon 404 habitual se conserva en el registro y no se confunde con un fallo del juego. Cambios high→low→medium→high reutilizan recursos; fuera de la isla quedan cero instancias activas. [Registro completo](../art/seaweed/runtime-evidence-v1.json).

Se inspeccionaron [mapa PC](../art/seaweed/desktop-map-v1.png), [detalle submarino PC](../art/seaweed/desktop-close-v1.png), móvil/low/fallback y [muestrario 1×](../art/seaweed/desktop-gallery-v1.png). La galería temporal se coloca sobre arena solo para mostrar pintura/silueta sin refracción, oculta vegetación/personajes durante la inspección y se elimina antes de cerrar el contexto; no forma parte del mapa. Dos capturas con reloj 0 y 2,1 muestran la oscilación de las hojas. El aro amarillo de fondo pertenece al tutorial existente.

La espuma y las cáusticas actuales reducen la lectura fina de las algas desde la cámara normal; el detalle submarino confirma su presencia y contacto. Calibrar agua/espuma es un corte posterior, no una promesa de acabado completo del fondo marino.

Ocho fuentes congeladas y sus hashes en `docs/art/source/seaweed-v1/`, sin refrescar entregas anteriores. Catálogo con tres previews primero, fuentes editables, informe y capturas. FPS físico, aceptación artística final y publicación pendientes. M5/SQL, chat/agentes y navegación mantienen sus entregas independientes.
