# Apariencia modular v1 — ensayo P03a

Fecha: 2026-10-08. Montaje local sobre las [bases v3](characters-base-v3.md), con cabello,
barba, ojos, cejas y colores intercambiables para ambos cuerpos. **P03a comprueba el contrato de piezas**;
el acabado artístico de P02 y la aceptación completa de P03 conservan sus gates abiertos.

**Estado visual — rechazo del autor, 2026-10-08:** el autor rechazó el arte de todas las bases
procedurales existentes y de estas mallas de apariencia por considerarlas feas y muy alejadas de la
referencia más reciente de Horizon Tides. Los modelos, capturas y descargas de este ensayo quedan como
prototipo técnico no aprobado; no son arte aceptado ni una dirección visual vigente. La lógica de montaje,
IDs, paletas, pesos y exportación puede servir como referencia de implementación. Este rechazo no acepta
ni registra una nueva fila en el catálogo. La evidencia HTTP sigue pendiente y el catálogo vigente no
contiene `char-appearance-male-v1` ni `char-appearance-female-v1`.

## Probar y descargar

Ejecutar `node tools/character-lab/server.mjs` y abrir
**http://127.0.0.1:5194/?v=3&appearance=1**. En v3, «Montaje → Personalizar» activa las piezas.

- Cabellos: Explorador, Barrido, Coleta y Corto, además de Calvo.
- Barbas: Afeitado, Barba corta y Barba de capitán, disponibles en ambas bases.
- Tres formas de ojos, tres cejas y cuatro colores de iris.
- Cinco paletas independientes para cabello, barba y cejas; tono de piel conserva su control anterior.
- Restablecer recupera las elecciones iniciales de piezas y sus paletas. Cambiar cuerpo o comparar v0/v1/v2 conserva las elecciones;
  las piezas se aplican solo al volver a v3. En móvil, la vista permanece visible al desplazar los controles.

«Descargar base GLB» conserva el archivo v3 original. **«Descargar personaje GLB» exporta la composición
actual**, colores incluidos, con cuerpo/IDs/calidad en los metadatos, rig y mapas embebidos. Exporta reposo
con materiales PBR; el shader toon/contorno y las poses de demostración pertenecen al visor.
Un cambio de cuerpo, versión, calidad o apariencia durante la exportación invalida esa descarga.
El exportador copia geometrías/materiales y restaura el reposo en una escena independiente.
No guarda una identidad de cuenta, inventario, equipo ni autorización de gameplay.

## Archivos preparados

Los siguientes archivos generados muestran la combinación inicial Explorador/afeitado/ojos serenos del
prototipo rechazado; se conservan solo como evidencia técnica, no como modelos visuales aprobados:

| Modelo | Triángulos | Mapas | Bytes |
|---|---:|---|---:|
| [Masculino escritorio](../art/source/character-appearance-v1/male-appearance-v1.glb) | 11.432 | 4 × 1024 | 837.708 |
| [Masculino móvil](../art/source/character-appearance-v1/male-appearance-v1-mobile.glb) | 11.432 | 4 × 512 | 639.100 |
| [Femenino escritorio](../art/source/character-appearance-v1/female-appearance-v1.glb) | 11.432 | 4 × 1024 | 838.232 |
| [Femenino móvil](../art/source/character-appearance-v1/female-appearance-v1-mobile.glb) | 11.432 | 4 × 512 | 639.628 |

Además hay **24 GLB de piezas**: cuatro cabellos, dos barbas, tres ojos y tres cejas por cuerpo.
Calvo/afeitado omiten sus piezas. Los acentos de nariz/boca se incluyen en el montaje completo.
Cabellos: 1.056–1.400 tris; barbas: 740/1.260; ojos: 1.120; cejas: 64.
La combinación más detallada del catálogo actual suma 12.692 tris; es un presupuesto geométrico,
no una medición de rendimiento. Las piezas usan color de vértice opaco, sin mapas adicionales ni cards alpha.
La descarga dinámica del navegador recodifica PNG y puede ocupar más bytes que los presets de esta tabla.

Fuentes editables: [generador y ensamblador](../../tools/character-appearance-v1/),
[catálogo de IDs/paletas](../art/source/character-appearance-v1/appearance-catalog.json) y
[recibo de modelos/dependencias](../art/source/character-appearance-v1/appearance-receipt.json).
Seis snapshots conservan la reconstrucción exacta. Las fuentes y GLB v0/v1/v2/v3 permanecen intactos.

## Encaje, recursos y reutilización

Las piezas se construyen en las coordenadas globales de bind de cada base y usan joint 8 (`head`),
con peso 1. El visor comparte el skeleton y las matrices inversas de la cabeza v3: contempla el origen
`[0, R.neck, .005]`, con cuello 1,54 m masculino / 1,51 m femenino. Conserva los quince huesos.
La cabeza y ropa permanecen; el overlay `eyes_base` original se oculta mientras se usan ojos/cejas/acento
seleccionados, y reaparece al desactivar la personalización. Cada cambio libera solo las piezas/materiales
que posee ese montaje; no reconstruye geometría en cada frame ni elimina los recursos de la base cacheada.

La inspección acotada del inventario Unreal/FAB no identifica un kit de cabello/barba exportado y compatible.
Se verificó existencia de los paquetes concretos `Kwang_GDC`, `Wukong` y `SKM_Manny_Simple`; su exportación,
dependencias y rig siguen sin verificar. `T_HairMask.uasset` es una textura candidata, no un kit de geometría.
Se usan masas paramétricas propias ajustadas a v3 para comprobar el montaje; fuentes Unreal intactas.
Referencias: [inventario](../research/unreal-assets/myproject/FINDINGS.md) y
[resumen](../research/unreal-assets/SUMMARY.md).

El cabello usa una cubierta del cráneo y mechones superpuestos; la coleta y barbas son estáticas.
La barba sigue el relieve subdividido para evitar que el mentón atraviese su superficie y deja la boca abierta.
El estudio sigue mostrando planos y siluetas simplificadas. Pintura/atlas, mechones finos, variantes anatómicas,
transición de barba/piel, máscaras bajo sombreros y dinámica requieren trabajo artístico posterior.
Los UV de estas piezas son coordenadas de estudio; no acreditan un atlas pintado sin solapamientos.
Dedos/ropa/cuerpo conservan las limitaciones de P02c y el futuro renderer debe preservar el bind v3.

## Evidencia técnica local — sin aceptación visual

- El informe [CPU](../art/character-appearance-v1/cpu-evidence-v1.json) tiene `passed: true`: 13 pruebas,
  13 aprobadas y 0 fallidas (seis de contrato de apariencia y siete del catálogo de arte), más inspección
  independiente de bytes GLB. Esto acredita contratos y estructura técnica; no acredita calidad visual.
- El informe [de navegador](../art/character-appearance-v1/browser-evidence-v1.json) **no pasó**: registra
  `Browser/network errors` en escritorio y cierre de página/navegador durante el caso móvil. Hay telemetría
  parcial y capturas guardadas, pero no se afirma aceptación de QA de navegador para el corte completo.
- Las [capturas](../art/character-appearance-v1/) documentan las mallas generadas y su montaje. El autor
  rechazó visualmente todas las bases procedurales y mallas de apariencia el 2026-10-08; las capturas no
  cambian ese estado.
- La [evidencia HTTP](../art/character-appearance-v1/artifact-evidence-v1.json) está pendiente: lista de
  artefactos vacía y fallo `pending`. No se verificaron descargas por HTTP. En el catálogo actual
  (`tools/art-catalog/catalog.json`, revisión 31) no hay filas para `char-appearance-male-v1` ni
  `char-appearance-female-v1`; no hubo registro nuevo aceptado.

```powershell
node --test tests/character-appearance.test.mjs tests/art-catalog.test.mjs
```

El comando conserva la reproducción de la suite CPU reportada; no representa una nueva ejecución en esta
actualización. La QA de navegador usa Chrome headless/WebGL de software y el informe de este corte falló.
No se afirma FPS físico, aceptación visual ni integración en la partida ordinaria. El nuevo trabajo artístico
debe partir de la referencia Horizon Tides y de un kit ilustrado aprobado por separado; los gates P02/P03
permanecen abiertos. Creador completo P05, persistencia P06 y equipo autoritativo P07 siguen pendientes.
No se cambió perfil, protocolo, simulación, servidor, migraciones ni manifest del juego.
