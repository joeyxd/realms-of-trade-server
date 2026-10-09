# Bitácora de arte del puerto

Catálogo local del proyecto: materiales, objetos, conjuntos y efectos, una fila por pieza. Dirección del
autor: ilustrado moderno, lectura tipo sprite y tinta/superficies pintadas cercanas a Borderlands.

Familia arena aplicada en [S01](../../docs/delivery/sand-family-v1.md): seca, mojada, ondulada
y muestra de orilla, con pares de color/normal y capturas PC/móvil. Las
[huellas dinámicas](../../docs/delivery/sand-footprints-v1.md) aparecen al caminar; el par pintado
se conserva como referencia y su banda estática queda apagada por defecto. Abrir el mapa con
`PROBAR-ARENAS.cmd` y **http://127.0.0.1:5192/?solo&debug&q=high&tod=day**.
S03 añade [hierba, tierra y dos transiciones](../../docs/delivery/ground-family-v1.md) al mismo mapa:
cuatro filas aplicadas, pares descargables, atlas PC/móvil y capturas. El catálogo tiene 80 filas;
la pequeña plaza conserva piedra y los alrededores/senderos usan los nuevos suelos.
S04 añade [conchas y cantos independientes](../../docs/delivery/beach-details-v1.md): dos filas aplicadas,
cuatro GLB compactos sin texturas nuevas, fuentes descargables y capturas. Las previews de muestrario
están ampliadas 1,7×; la evidencia de mapa/contacto muestra el tamaño real. Revisión actual 9/80 filas.
«Archivos preparados» puede incluir un
candidato con revisiones pendientes; leer sus notas antes de usarlo o considerarlo aprobado.

## Abrir

Desde la raíz, ejecutar `CATALOGO-DE-ARTE.cmd` o `node tools/art-catalog/server.mjs`, y abrir
**http://127.0.0.1:5190**. Otro puerto: `node tools/art-catalog/server.mjs --port=5191`.
No necesita instalar dependencias. El servidor escucha solo en este equipo; es una herramienta de arte
local separada del juego y del laboratorio naval.

## Trabajar por filas

1. Buscar o elegir categoría. «Siguiente pieza» abre la primera pieza visible todavía sin aplicar.
2. Abrir «Ficha» y guardar la imagen de referencia. Las láminas recibidas solo en chat aparecen
   identificadas; para mostrarlas aquí necesitamos el archivo original.
3. Añadir albedo, normal, máscaras, modelo, fuente editable y variante móvil según corresponda.
   Cada archivo conserva su versión; subir una referencia no la convierte en una textura utilizable.
4. Anotar siguiente paso, variantes/destino y notas; guardar ficha. «Archivos preparados» identifica una
   entrega lista para revisión, y la ficha de integración lista las rutas para trabajar juntos.
5. Integrar el recurso en su consumidor del juego, revisar capturas/PC/móvil y añadir captura o informe
   como «Aplicación». Después marcar «Aplicado en juego» con su alcance en las notas.

Cambiar un estado registra seguimiento; no ejecuta importaciones ni modifica el renderer. La aplicación
real se hace pieza por pieza usando la ficha y el contrato de assets, con evidencia del resultado.

## Datos compartidos

- `catalog.json`: lista versionada, notas, referencias, archivos y evidencia; la leen autor y agentes.
- `docs/art/catalog-files/<id>/`: entregas subidas, con nombres únicos para conservar versiones.
- Los recursos existentes permanecen en `assets/` y sus informes/capturas en sus rutas originales.
- «Exportar catálogo» descarga el JSON actual; «Copiar/Descargar ficha de integración» prepara el trabajo
  de una pieza con referencias, archivos, destino y siguiente paso.

No se usa localStorage como autoridad. Guardado y uploads escriben el JSON del proyecto; una revisión
del catálogo evita pisar cambios de otra ventana. El servicio es un solo proceso local; cerrar el proceso
detiene la edición pero conserva archivos y datos. Los archivos fuente grandes pueden permanecer
fuera del bundle del juego y se optimizan antes de integrar derivados.

## Verificación

`node --test tests/art-catalog.test.mjs` verifica guardado/recuperación, uploads, revisiones y límites de
acceso. Las pruebas usan carpetas temporales y no cambian el catálogo real ni perfiles del juego.
La revisión visual de esta herramienta no acepta FPS ni el arte nuevo del juego.
