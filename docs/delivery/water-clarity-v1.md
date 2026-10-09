# S11 — agua más clara y espuma costera

Fecha: 2026-10-07. Aplicado y verificado en el preview local del juego.

La costa conserva su agua turquesa y el borde blanco de espuma, con una trama más fina y
fragmentada. Las cáusticas dejan más espacio al fondo pintado y a las algas de S10.
Se reduce la refracción de 0,035 a 0,02. También se corrige un framebuffer incompleto
al alternar calidad, detectado durante esta comparación.

## Comparación y calibración

| Vista | Antes | Después |
|---|---|---|
| Costa cercana | [PC antes](../art/water-clarity/desktop-close-before-v1.png) | [PC después](../art/water-clarity/desktop-close-after-v1.png) |
| Cámara de mapa | [PC antes](../art/water-clarity/desktop-map-before-v1.png) | [PC después](../art/water-clarity/desktop-map-after-v1.png) |
| Profundidad | [PC antes](../art/water-clarity/desktop-deep-before-v1.png) | [PC después](../art/water-clarity/desktop-deep-after-v1.png) |

El canal G de `noiseTex.js` guarda distancia a los bordes de celdas, normalizada.
La espuma y la cáustica anteriores amplificaban esos mismos bordes: una red blanca gruesa
dominaba la costa. S11 reutiliza esas muestras y las olas existentes para formar cintas
antialiasadas con derivadas, acotar el ancho y romper su continuidad.

- Cáustica: intensidad compartida 0,12 y ancho de borde 0,035; la ruta SSR y la cáustica
  del terreno low usan la misma función. La puerta de calidad existente evita duplicarlas.
- Espuma: contacto ×0,55 con variación de ruido; trama 0,035, fuerza 0,52 y líneas de ola 0,28.
  El contacto y las cintas conservan antialiasing. La trama se desvía con olas ya muestreadas.
- Luz de superficie: 0,07 → 0,035. Refracción: 0,035 → 0,02. Colores de absorción/turquesa,
  reflejos de cielo, destellos, bloom y alfa mantienen sus contratos anteriores.

En agua profunda permanecen los reflejos y manchas de brillo del estilo existente.
Esta pasada resuelve la legibilidad de espuma/cáusticas; el balance artístico fino sigue
abierto al autor. La calidad baja conserva una costa más discreta y su fondo sin refracción.

## Corrección de calidad

La evidencia anterior registra GL1286 en low → medium. Un probe aisló el fallo en
`rtNormal`: framebuffer con attachment incompleto (36057). Esperar más frames no lo resolvió.
En low, un sampler de profundidad puede solicitar almacenamiento antes de que el framebuffer
se vuelva a usar; su imagen conservaba dimensiones anteriores al resize.

`pipeline.resize()` ahora dispone ese almacenamiento cuando cambia el tamaño de imagen,
sin cambiar el objeto `DepthTexture`; actualiza dimensiones y solicita subida antes de
que pueda enlazarse como sampler. Los bindings de FX, agua y composite conservan identidad.
El resize de igual tamaño no vuelve a disponer/subir la textura. Esto también cubre una
sesión que arranca en low y pasa a high, comprobada en navegador.

## Alcance y reutilización

El [brief](../briefs/visual-s11-water-clarity.md) registra dos archivos Unreal concretos
revisados en lectura: `M_Water.uasset` (10.512 B) y `T_Noise_DistortedCaustic.uasset`
(509.646 B), ambos del proyecto Survival. No hay shader/textura portable inspeccionados
que justifiquen sustituir la solución actual; se conserva la calibración nativa.

No se añaden imágenes, GLB, entradas de textura ni pases. El agua sigue siendo dos
triángulos y dos materiales reutilizados al alternar calidad. El resize recrea almacenamiento
GPU únicamente al cambiar tamaño. No se cambian posiciones/normales/máscaras/índices del
terreno, anclajes de algas ni datos de simulación. El shader reutiliza sus muestras existentes.

Las once fuentes finales están congeladas en el
[recibo S11](../art/source/water-clarity-v1/final/source-snapshot.json): tres textos previos
normalizados a LF y ocho copias finales con bytes/SHA-256. El snapshot de la primera corrección
de diagnóstico se conserva aparte sin refrescarlo. `prepare-water-clarity-sources.mjs --check`
valida las copias históricas; no exige que futuras ediciones del renderer sigan iguales.

## Verificación local

**88/88 pruebas pertinentes**, sin omisiones, en quince archivos. Las cinco regresiones
propias cubren modos SSR/simple, bindings y controles compartidos, geometría estable y
lifecycle del depth antes de usar el framebuffer.

La [matriz runtime](../art/water-clarity/runtime-evidence-v1.json) conserva tres contextos
anteriores (PC, móvil emulado, low) y seis finales: PC high, móvil medium, low, noassets,
noche y viewport vertical. Cada caso tiene vistas mapa/cerca/profunda: **27 capturas**.
Tiempo del agua fijo en 4,2; cámaras de costa (116,8925; 95,8523), distancia 22/5, y agua
profunda (135; 112), distancia 32. El metadata anterior conserva el target originalmente
reportado y la corrección derivada de los parámetros de vista.

Los seis casos finales y sus **24 cambios high → low → medium → high** pasan: errores
de página/juego vacíos, GL0, programas enlazados, geometría/materiales de agua reutilizados,
SSR y gate de cáusticas correctos. El único error de consola permitido es el favicon 404
del preview; se conserva en el JSON. Capturas finales inspeccionadas, incluidas low y noche.
Vertical usa el stage horizontal rotado que ya tiene el juego; no certifica un layout vertical nuevo.

Los contadores de toda la escena se conservan como diagnóstico. Otras piezas navales y
contenido de sesión cambiaron durante el trabajo compartido; no son una comparación aislada
de coste S11 ni una medida de FPS. Rendimiento físico, aceptación artística del autor y
publicación siguen pendientes. Esta entrega no modifica el host público ni aplica SQL.

## Catálogo

Las dos filas existentes `m11-mar-espuma` y `fondo-marino` pasan a aplicadas localmente,
con tres previews finales al principio, referencia original, fuentes y comparación completa.
`vfx-contacto-agua` permanece pendiente: el sistema completo de contacto de jugador/barco
no se acepta en esta calibración. El registro usa compare-and-swap y una repetición idempotente;
el verificador comprueba los enlaces servidos por SHA-256 y las filas de la revisión activa.

Registro final: revisión **18**, 83 filas/32 aplicadas. **44 enlaces HTTP únicos** exactos
por SHA-256, incluyendo fuentes, documentos y capturas; repetición idempotente sin nueva revisión.
Las otras 81 filas conservan su contenido byte-equivalente en JSON. Ficha Mar y espuma inspeccionada:
27 imágenes decodificadas al recorrer su galería y once enlaces a fuentes congeladas.

Preview del juego: <http://127.0.0.1:5192/?solo&debug&q=high&tod=day>.
Catálogo: <http://127.0.0.1:5190>.
