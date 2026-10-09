# S04 — conchas y cantos de playa

Fecha: 2026-10-06. Corte visual local después de S01–S03, solicitado al continuar el trabajo por filas.

Completar `conchas-playa` y `cantos-guijarros`: conchas independientes marfil/coral, con borde oscuro y
formas de abanico, ovalada y fragmento; grupos bajos de tres cantos grises cálidos. Probar la escala desde
la cámara normal antes de ampliar densidad. Los pequeños motivos pintados en la arena siguen siendo su acabado.

Reutilización revisada: `SM_Rock` Dreamrise, exportado y verificado en S02
(`docs/art/source/coast-rock-v1/SM_Rock.unreal-report.json` y `assets/models/coast-rock-v1.glb`). Su geometría
se reaprovecha para los cantos, sin exportar Unreal otra vez. No se encontró una concha utilizable en los
inventarios actuales. `M_Pebbles`/`MI_Pebbles` de NiagaraExamples son materiales sin port verificado y no
resuelven estas siluetas. Las conchas serán geometría propia con color por vértice: fuente JS y GLB portable,
normales geométricas, sin nuevos PNG ni samplers. La lámina del autor sigue siendo la referencia de estilo.

Límites: renderer únicamente, sin consumir RNG del mundo, modificar props, alturas, colisiones, inventarios
ni protocolo. Hasta 144 conchas y 96 grupos de cantos en toda la isla, dispersos en arena expuesta poco
inclinada y separados de caminos, tutorial, spawn, muelle y props. Instancias por chunks y frustum existente.
Un mismo modelo compacto para PC/móvil, sin descarga de texturas nueva; fallback geométrico si falta GLB.

Aceptación técnica: archivos/hashes/budget verificados; distribución determinista e invariancia del mapa;
capturas reales PC, móvil emulado y low inspeccionadas; probar 404, GLB inválido y noassets. Registrar previews,
modelos, fuentes y evidencia en las dos filas con escritura CAS. Estilo final y FPS físicos permanecen abiertos.
