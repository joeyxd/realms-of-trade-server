# D08b3 — espuma, corriente y tinta

## Alcance

B3 lleva la bahía naval aislada hacia la referencia de persecución: estelas blancas anchas que conservan la curva histórica del rumbo, spray lateral, corriente cyan fragmentada y tinta negra periférica. Es una capa visual del laboratorio (`localhost:5180`); no cambia manejo, controles, simulación autoritativa ni audio.

## Implementación

- Estelas históricas blancas de capacidad fija: 40 muestras en escritorio y 24 en móvil, con dos cintas y seis vértices por segmento.
- Spray de proa en láminas geométricas: nueve segmentos por lado en escritorio y seis en móvil; cada segmento usa 12 vértices. El sombreado de profundidad evita que las cintas y el spray cubran casco o vela.
- Corrientes con 80 triángulos en total para los dos carriles, desvanecimiento en los extremos y ruido animado cyan/blanco. El ruido reutiliza `U.mnNoiseTex` de 256×256; no añade descargas de mapas de bits.
- Tinta negra en 40 trazos para escritorio y 24 para móvil, repartidos por los cuatro bordes de un SVG de 1000×1000. El rectángulo central seguro `x=300..700, y=140..800` queda libre para la balsa y la ruta.
- Pausa, reinicio, liberación de recursos y movimiento reducido conservan sus límites. Los efectos permanecen bajo propiedad del laboratorio.

## Reutilización

La capa usa geometría, shaders, ruido compartido y profundidad del pipeline Three.js existente; no necesita una textura nueva. El inventario Unreal deja `C:\Unreal\MyProject\Content\_SplineVFX\NS\NS_Spline_WaterSplash.uasset` (5,381,446 B), su Blueprint `C:\Unreal\MyProject\Content\_SplineVFX\_GenericSource\BP\BP_SplineVFX_WaterSplash.uasset` (68,664 B) y `C:\Unreal\MyProject\Content\_SplineVFX\_GenericSource\Texture\T_Vfx_Stamp_WaterSplash_77.uasset` (1,577,127 B) como referencias de ruta/nombre. Solo hay miniatura del sistema; alfa, materiales, dependencias y exportación portable no están verificados. Por eso B3 recrea la forma con recursos del juego y deja intactas las fuentes Unreal.

## Aceptación y límites

La implementación local pasó 80/80 pruebas pertinentes en 14 archivos. Se revisaron boost y giro cercano a 90° en escritorio, boost en móvil emulado horizontal/vertical y casa 4×4 en los tres formatos, sin errores registrados. Se corrigió el nivel de las paredes del fixture de casa; su altura y estabilidad cambian de acuerdo con las fórmulas existentes. Detalles y capturas en [la entrega](../delivery/d08b3-foam-current-ink.md). Quedan pendientes FPS en teléfono físico y aprobación visual humana completa.

El siguiente corte es B4, HUD naval con velocidad real en u/s, corriente, ráfagas y acciones existentes. No introducir enemigos, combo ni nudos ficticios.
