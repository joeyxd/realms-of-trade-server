# D08b.2 — madera del autor y lona envejecida

2026-10-06. El autor aporta `materials/raft material.jpg` y `materials/raft material normal.jpg`
y pide evaluar el material y continuar hacia la referencia naval. Ambas imágenes se inspeccionaron:
lámina cuadrada 2048 × 2048 de tablones marrón/gris, clavos, manchas y grietas negras de cómic;
el normal sigue la misma disposición. Es una lámina de piezas, no una textura continua para repetir entera.

## Corte

- Asignar a cada pieza una de cuatro regiones horizontales del material, con la veta sobre el eje largo.
  Albedo y normal comparten UV. Dejar un margen respecto a los huecos negros de la lámina.
- Probar color 1024 y normal 1024 en escritorio; móvil empieza con color 512 y sin cargar normales.
  Preparar también el normal 512 para una evaluación posterior, sin activarlo automáticamente.
- Normal con datos lineales, filtro y renormalización al reducir; fuerza suave de 0,28.
  La convención del canal verde es desconocida: comparar relieve plano, suave e invertido en la bahía.
- Conservar cuerda/hierro y remiendos del atlas aprobado. Recolorear la lona localmente a gris verdoso,
  conservando diferencias de valor, costuras y manchas. No generar otra textura de vela en este corte.
- Ofrecer comparación con el atlas anterior sin reiniciar velocidad, carga o rumbo.

El estudio se carga solo desde `tools/naval-lab/`. El manifiesto global, el material de las balsas del
juego principal y los assets de la isla conservan su ruta existente. `RaftLayer` recibe un perfil opcional
por instancia: UV/materiales clonados y caché propia. El perfil es dueño de sus texturas; el layer libera
materiales/geometrías. No se cambian fuerzas, captura de ráfagas, corrientes, audio ni persistencia.

## Presupuesto y comprobaciones

Derivados comprimidos, originales fuera del bundle público. Una variante de color por dispositivo;
ninguna petición de normales en móvil. El par de fuentes ocupa 6.792.224 bytes; no se usa directamente
en el render. Registrar hashes, tamaños y dimensiones de los derivados en `docs/art/raft-wood-boards-v2.json`.
Las estimaciones RGBA/mipmaps no demuestran VRAM real ni FPS de teléfono.

Revisar aislamiento frente al renderer original, orientación y recortes de UV en cajas/cilindros,
fallback por fallos de carga, disposición de recursos y cambio de material sin modificar simulación.
Capturas de escritorio/retrato/paisaje, vela/casa 4 × 4, comparación de relieve y URL/resolución realmente
cargadas son gates visuales. No aceptar el resultado por los tests o por inspeccionar solo la lámina.

## Reutilización

La madera aportada por el autor evita crear otra imagen. El atlas aprobado 1024/512, aparejo procedural
y caja Dreamrise exportada se reutilizan. Los candidatos Unreal conservan sus fuentes intactas y requieren
exportación/preview antes de sustituir geometría; revisión acotada de candidatos por Luna en esta misión.
Barril, llantas y rueda decorativa de la referencia quedan para otro corte tras revisar el material en juego.
Espuma/corriente/tinta y HUD continúan como B3/B4; no fingir persecución, daño o módulos funcionales.
