# D08b.3 — estela, spray, corriente y tinta

2026-10-06. Implementado y revisado en la bahía local: <http://127.0.0.1:5180/>.
Fuente: `f6da8dc8b0d044c0cd85beb938c3bf8239ba5a60`. Primer corte B3, no fidelidad final a la referencia.

## Resultado

La estela blanca conserva cuatro segundos del recorrido real, se abre detrás del casco y curva con
el rumbo histórico. Dos abanicos de agua en la proa y el spray existente responden a velocidad,
boost y carga de giro. La corriente cyan sigue los mismos carriles de la simulación, ahora con
espuma fragmentada, bordes irregulares y extremos que se desvanecen. Trazos negros de tinta fina/gruesa
en los cuatro bordes sustituyen las líneas crema, dejando libre el centro para casco, vela y ruta.

Los shaders reutilizan el ruido procedural compartido de 256²: ninguna nueva textura, descarga ni
archivo de audio. El material de madera del autor sigue en 1024 escritorio / 512 móvil, sin normal
runtime móvil. La comparación con el atlas anterior continúa disponible.

| Recurso | Escritorio | Móvil |
|---|---:|---:|
| Historial por cada una de dos estelas | 40 muestras | 24 muestras |
| Máximo de vértices dibujados de ambas estelas | 468 | 276 |
| Abanicos de proa, dos meshes | 72 triángulos | 48 triángulos |
| Corrientes, dos carriles en un mesh | 80 triángulos | 80 triángulos |
| Pool de spray compartido | 288 partículas | 144 partículas |
| Trazos SVG periféricos | 40 | 24 |

Las cintas y abanicos usan la profundidad del pipeline: test de profundidad opaca en modo alto,
profundidad hardware en modo ligero. Los abanicos añaden dos llamadas de dibujo; las dos estelas
sustituyen las cintas anteriores. Presupuesto acotado no demuestra FPS ni coste de transparencias
en un teléfono real. Cada fragmento de corriente/estela añade una lectura del ruido existente.

## Revisión y corrección de la casa

Chrome: escritorio 1280×800; móvil emulado horizontal 844×390 y vertical 390×844. Se inspeccionaron
capturas guardadas del boost, giro, ambos formatos móviles, comparación de acabado/relieve,
vista isométrica y casa 4×4. Se activó un «perfecto» con el botón real, no modificando la simulación.
El giro se hizo manteniendo el control visible de estribor; terminó cerca de 89,5°.
La tinta queda fuera de la vela/balsa y la espuma no pinta sobre el casco en las vistas revisadas.
Los registros de error de la pestaña quedaron vacíos.

La casa de prueba tenía paredes en nivel 0 mientras suelo/cama/techo estaban en nivel 1. Se movieron
las dos paredes existentes al nivel 1, después de sus suelos, conservando sus pilares de apoyo.
La nueva disposición se volvió a revisar en los tres formatos. Es una corrección del fixture local:
masa total 143, flotación 224 e inercia 951,263 permanecen; altura del centro pasa de 0,3343 a 0,4434
y estabilidad de 0,9398 a 0,9228. En la comparación automática el giro de casa cambia de 4,85 a 4,93 s.
Las fórmulas, controles, fuerzas, timing, audio y fixtures de balsa ligera/carga siguen iguales.

URL móvil realmente cargada: `/assets/textures/raft/wood-boards-v2-mobile.webp`, 512×512;
normal `null`, sin solicitud de `wood-boards-v2-normal*`. Escritorio carga color y normal 1024².
Al apagar «Efectos de cómic» durante un boost pausado, intensidad de tinta y roll pasan a cero,
FOV naval vuelve a 50° y el estado de pilotaje se conserva. Pausa, reinicio, expiración de estela,
COM desplazado, movimiento reducido y liberación de recursos están cubiertos por pruebas.
Movimiento reducido no se verificó mediante un ajuste de accesibilidad del sistema real.

**80/80 pruebas pertinentes en 14 archivos**, Node v24.14.0, exit 0, después de corregir la casa.
No se repitió la suite global de M5. [Evidencia estructurada](d08b3-foam-current-ink-evidence.json)
contiene paths, hashes, dimensiones reales y snapshots. Las imágenes son JPEG del navegador,
guardadas localmente en `shots/naval-reference-20261006/`; ese directorio no se publica ni se versiona.
Viewport restablecido a su tamaño nativo 824×742 CSS, DPR 1,5; pestaña entregable abierta y pausada.

## FAB y continuidad

Se revalidaron en `C:\Unreal\MyProject\Content\_SplineVFX`:
`NS/NS_Spline_WaterSplash.uasset` (5.381.446 B),
`_GenericSource/BP/BP_SplineVFX_WaterSplash.uasset` (68.664 B) y
`_GenericSource/Texture/T_Vfx_Stamp_WaterSplash_77.uasset` (1.577.127 B).
Hay miniatura de sistema, no una exportación de alfa/material/cinta validada para el navegador.
Se reutilizan ruido, partículas, profundidad y campo de corrientes del juego; fuentes Unreal intactas.
GPT-6 Luna hizo revisión acotada de reutilización, tinta, pruebas y diagnóstico de casa;
el principal integró efectos, corrigió el fixture y revisó pruebas/capturas.

Quedan aprobación visual del autor, rendimiento físico móvil y calibración fina del normal/mipmaps
de B2. B4 es el siguiente corte: dial de velocidad real en u/s, tarjetas de acciones implementadas,
avisos de corriente/ráfaga y carta/rumbo. Ancla, combo, nudos, rival y persecución esperan sus sistemas.
El juego principal, protocolo, manifiesto, SQL y persistencia M5 conservan su trabajo separado.
Sin despliegue público en este corte.
