# Skill Studio: Niagara intake

Fecha: 2026-10-11. Revisión acotada para el brief `docs/briefs/skill-studio-vision.md`.

## Recomendación

Usar `MyProject/Content/_SplineVFX/NS/NS_Spline_WaterSplash.uasset` como primer candidato fuente para adaptar visualmente **Tromba**. La habilidad ya tiene una secuencia de agua en `src/render/vfx/skillfx.js`; el splash puede aportar una referencia concreta de impacto acuático. Esto es una recomendación por encaje, no evidencia de que el sistema funcione en runtime, tenga parámetros expuestos ni vaya a poder exportarse sin cambios.

La entrada del inventario asigna a esta familia la ruta absoluta `C:\Unreal\MyProject\Content\_SplineVFX\NS\NS_Spline_WaterSplash.uasset`, tamaño **5,381,446 bytes**. La ruta y el tamaño coinciden con `docs/research/unreal-assets/myproject/files.csv`; se comprobó la existencia y tamaño de ese archivo fuente, sin abrir ni modificar el proyecto.

## Candidatos confirmados

| Ruta bajo `C:\Unreal\MyProject` | Tamaño | Uso posible | Evidencia y límite |
| --- | ---: | --- | --- |
| `Content/_SplineVFX/NS/NS_Spline_WaterSplash.uasset` | 5,381,446 bytes | Tromba: salpicadura en el golpe/colapso | Existe según comprobación de ruta y el inventario. La ficha solo registra nombres y miniaturas de familia; spline, materiales y dependencias no están verificados. |
| `Content/NiagaraExamples/FX_Weapons/Impacts/NS_Impact_Wood.uasset` | 4,773,771 bytes | Impacto de golpe o Abordaje | Existe y está listado. Nombre/ruta sugieren impacto de madera; no se confirmó clase, apariencia en marcha o dependencia. Revisar astillas antes de asignarlo a otro material. |
| `Content/_SplineVFX/NS/NS_Spline_Magic.uasset` | 4,638,018 bytes | Referencia para variante mágica | Existe y está listado. El nombre sugiere magia; no hay validación de aspecto, grafos, parámetros ni coste. |

Como referencias secundarias existen `Content/NiagaraExamples/FX_Smoke/NS_Chimney_Smoke.uasset` (**956,724 bytes**) y `Content/SlashTrailElemental/Niagara/Fire/NS_SlashTrail_Fire.uasset` (**1,561,719 bytes**). No son la primera elección para un impacto de Tromba. Las rutas, tamaños y existencia provienen de `myproject/files.csv` y comprobaciones puntuales de esos archivos.

El inventario conjunto `CANDIDATES.csv` registra la familia impacto/humo/splash como **tipo desconocido**, con dependencias de Niagara, materiales, texturas y spline sin resolver; también aclara que las vistas de humo/splash son miniaturas y no un sistema en ejecución. La familia de trails tiene la misma limitación de comportamiento y dependencias. Un nombre o miniatura no demuestra el aspecto animado, calidad, rendimiento o portabilidad del efecto.

## Adaptación y dependencias por resolver

En una fase posterior de inspección visual en Unreal, abrir solo el sistema elegido y anotar:

1. Secuencia y duración de emisores, condiciones de spawn, bucles y eventos; distinguir el sistema Niagara del actor/Blueprint que coloca o conduce la spline.
2. Parámetros de usuario realmente expuestos (escala, cantidad, velocidad, color, duración) y sus rangos observados. El taller debe mapear solo controles comprobados a un descriptor seguro.
3. Renderers y dependencias transitivas: materiales, texturas/flipbooks, mallas, curvas, módulos/plugins y cualquier Blueprint de spline. Confirmar alpha, color, orientación y escala antes de considerar una textura exportable.
4. Comparación de composición a igual cámara y duración con Tromba; medir coste después de recrearlo en el renderer del juego.

La entrega al navegador debe ser una recreación en Three.js bajo `src/render/vfx/**`, enlazada a eventos visuales ya emitidos por la habilidad. No cargar el `.uasset` ni copiar scripts Niagara/Blueprint. Reusar solo recursos visuales puntuales tras confirmar formato, dependencias y utilidad; versionar los controles validados en el descriptor del efecto. Mantener daño/radio/cooldown en simulación sin alterarlos desde controles visuales.

## Encaje con los sistemas existentes

`src/render/vfx/skillfx.js` ya implementa Tromba como columna de agua, bandas de espuma, aro y partículas sobre eventos de combate, con objetos/pools creados de antemano. Es el punto de comparación y reutilización para una primera habilidad ajustable; el candidato Unreal no crea un puente de ejecución.

La animación nativa existente es limitada y específica: `src/render/assets/characterFigure.js` usa un clip glTF declarado por entrada para la figura/hoja del personaje; `src/render/assets/characterSwim.js` ejecuta un clip nativo de nado in-place con mixer y adapta la malla a la presentación actual. El manifiesto y `rebind.js` preservan el rig de juego de 15 huesos. Esto no aporta selector general de clips ni retargeting validado para cualquier rig/animación Unreal. Para Skill Studio, empezar con la animación compatible existente y dejar clips ajenos pendientes de compatibilidad de rig y marcadores.

## Alcance de esta revisión

Lectura de fichas existentes y comprobación puntual de existencia/tamaño de los archivos mencionados bajo `C:\Unreal\MyProject`. No se hizo barrido del inventario, inspección en Unreal, exportación, captura de runtime, modificación de fuentes ni prueba visual/GPU. La animación, parámetros y dependencias siguen pendientes de inspección del sistema en Unreal.
