# GM05a — pinceles de escultura del terreno

**Implementación integrada alpha.44/protocolo 50; aceptación de navegador y publicación en curso.**
Continúa [GM04b](../gm04b/DELIVERY.md) y el [contrato previo al código](../../briefs/gm05a-terrain-sculpt.md).

La pestaña **Terreno** permite subir, bajar, aplanar, suavizar y construir una rampa con dos clics.
Radio 2–24 m, fuerza, caída suave y cota de aplanado. Arrastrar aplica un trazo; soltar lo conserva como
una operación de deshacer. Escape o pérdida de foco cancela el preview completo. La prueba caminando
usa la proyección del borrador, sin ganancias ni cambios de gameplay persistidos.

El primer corte trabaja sobre suelo seco existente. Costa, muelles, servicios, recursos, rutas y áreas
funcionales tienen protección también en el servidor. Un trazo bloqueado se rechaza completo. Las
decoraciones seguras conservan su offset vertical mediante transformaciones explícitas del documento.
GM05b añadirá pintura de familias de suelo; GM06 cubrirá nueva tierra, costa y expansión del dominio.

Documento v3: deltas enteros en milímetros sobre 561×561 muestras, ordenados y únicos, hasta 20.000
entradas y ±12 m. Los documentos v1/v2 conservan su normalización y forma anteriores. SQL030 extiende
el guardado privado SQL020 y conserva sus recibos históricos. **SQL aplicado por el autor y readiness
live verificado desde el servicio del VPS:** terreno 1 y contrato anterior 1. [Resultado](sql-live.json).
El archivo se renombró de 029 a 030 al integrar el corte concurrente de Carga; su contenido/hash es idéntico.
La preparación firma las alturas Float32 completas; el cliente las recompila y verifica antes de entrar.
El catálogo de recursos mantiene IDs/alturas base. Activación y rollback usan la autoridad, exclusión,
CAS y guardas de perfiles, drops y balsas existentes; no hay otra autoridad de guardado.

La malla canónica y el sampler comparten triangulación en las celdas editadas. Fuera de ellas se conservan
las funciones base exactas. Preview privado para geometría, agua y cartografía; cerrar restaura los recursos
visuales originales. Se reutilizan las familias de suelo actuales, sin mapas 2K/4K nuevos ni cambios a
fuentes Unreal. [Candidatos revisados](../../briefs/gm05a-terrain-assets.md). Con deltas, la malla completa
usa 560×560 celdas; su coste supera el anterior. FPS en teléfono físico y optimización por sectores/LOD
no están aceptados en este corte.

La integración final alpha.44 pasó **275/275 en 51 archivos**, con hashes de fuentes estables:
[resumen](integration-final-lighting/regression.json) y [TAP](integration-final-lighting/regression.tap). Incluye la cadena HTTP real save→prepare→register→activate,
cliente nuevo con alturas exactas, rechazo de hash alterado, admisión WebSocket y rollback; además SQL030
en PGlite, replay v2/v3, reejecución y ACL, más la compatibilidad con el corte concurrente de Carga.
Las regresiones anteriores alpha.43 (238/238) y alpha.44 (274/274) se solapan. La final incluye el panel
desplazable con controles primero, colocación/apoyo de modelos sobre la altura editada y la prueba de
guardado pendiente que conserva un aviso posterior de rechazo. El foco de iluminación del editor también
usa el terreno proyectado.

El [navegador local final](local/final-visible-5/local-browser-evidence.json) pasó **10/10**, sin errores:
gestos reales de los cinco pinceles, terraza elevada 1 m, rampa recorrida a pie, undo/redo, rechazo atómico,
Escape, export/import/reapertura v3 y colocación de un modelo real a 4,585267 m (base 3,585267 m).
Las cinco capturas ES/EN, escritorio y 844×390 fueron inspeccionadas; el control de radio funciona en
la vista estrecha. QA sitúa el inicio caminable en el extremo bajo y después usa teclado real: cinco muestras
cruzan la rampa y una pasa a 0,31 m del extremo alto. La carrera de guardado usa un temporizador de QA
de 5 s que llama al guardado real; blur despacha explícitamente ese evento sobre un trazo de puntero real. No son pruebas
de foco nativo, latencia física ni rendimiento móvil. La compilación conserva las texturas actuales.

El primer intento de regresión pasó 231/235 mientras las fuentes cambiaban; no se cuenta como aceptación.
Reveló la lista de archivos de runtime incompleta del registro. Los intentos iniciales de navegador
revelaron supuestos de idioma, comparación insuficiente de cambios y un extremo de rampa debajo del
inspector; se conserva la evidencia de diagnóstico, pero no acredita el recorrido completo.

Faltan aquí las capturas finales inspeccionadas, la release comprobada
y la cadena pública con Supabase real. No se declara desplegado a partir de pruebas locales.
