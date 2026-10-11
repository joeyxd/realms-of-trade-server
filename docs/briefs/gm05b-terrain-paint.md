# GM05b — pintura de suelo y pinceles compartidos

Objetivo aprobado: volar en el GM, pintar hierba, tierra, arena o roca sobre suelo seco existente,
mezclar bordes y recuperar el acabado automático con un borrador reversible. Una pasada conserva
preview, cancelación, undo/redo, guardado, prueba caminando y preparación/publicación existentes.

## Contrato del corte

- Pinceles circular, cuadrado y elíptico; radio 2–24, fuerza, borde suave, proporción y giro.
  La rampa mantiene su corredor circular entre dos extremos.
- Pintura de cuatro familias con pesos enteros de 8 bits; la parte restante conserva el material
  automático. Borrar reduce los pesos, sin cambiar alturas, objetos, recursos ni colisiones.
- Documento v4, terreno v2: `samples` existentes y `materials: [[index,grass,dirt,sand,rock],...]`.
  Índices de la cuadrícula 561² ordenados y únicos; canales 0–255, suma 1–255; máximo 20.000
  entradas de cada tipo. V2/v3 permanecen legibles y conservan su representación/hash.
- La validación de mapa protege también los vecinos de interpolación de la pintura. No se admite
  mar, rutas, servicios, arena de combate, volcán, recursos ni props protegidos. Rechazo atómico del trazo.
- Renderer, consulta de material y cartografía leen la misma capa; los pesos se interpolan con
  los mismos triángulos alternados de la malla. Las alturas mantienen su contrato GM05a.
- SQL033 amplía solo el guardado privado. El host sigue validando referencias/geografía. Sin
  reescritura de recibos/perfiles, ni segundo escritor de gameplay.

## Reutilización y presupuesto

Hierba/tierra: atlas existente `src/render/groundMaterials.js`; arena: Dry de
`src/render/sandMaterials.js`; roca: acabado procedural actual de `src/render/terrain.js`.
No se añaden texturas ni dependencias. Atlas móvil 1024², dos mapas, 2.231.340 bytes; arena móvil
512². El registro existente elige una variante por dispositivo.

Inventario Unreal/FAB contrastado: `Dreamrise_SMSK/Assets/Materials/M_Landscape.uasset`,
`SlashTrailElemental/Resource/Texture/T_Rock2x2.uasset` y `T_Sand_M_00.uasset` son candidatos
empaquetados sin exportación raster/dependencias verificadas. No sustituyen las familias ya
integradas; fuentes intactas. THREE.Terrain queda como candidato de generación futura, sin
dependencia nueva para pintar. Costa/islas, importación de imágenes, dispersión y LOD siguen
en sus cortes posteriores.

## Aceptación

Pruebas de canon/compatibilidad v2–v4, pesos/bordes/formas, conservación al esculpir y borrar,
protecciones cliente/servidor, guardado/replay SQL y contenido preparado con hash exacto.
Navegador ES/EN, escritorio/móvil emulado: pintar/borrar, preview/cancelar, undo/redo, recargar
borrador, caminar y restaurar escena. Capturas inspeccionadas y errores WebGL registrados.
Publicación solo tras integrar el corte completo, SQL/readiness y comprobación real del VPS.
