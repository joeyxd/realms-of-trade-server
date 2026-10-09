# S06 — raíces y plantas al pie de las palmeras

Fecha: 2026-10-07. El autor autorizó continuar la pieza propuesta al cerrar S05. Ensayo visual local.

Raíces en geometría real, dos o tres rosetas de hojas y arena visible entre ellas. Se aprovecha el atlas
de componentes del autor; no se pega la ilustración de una base completa con arena/piedras como un disco.
Las palmeras completas de S05 y los arbustos existentes conservan su función.

## Reutilización comprobada

Consulta acotada del inventario Unreal y existencia/tamaños de candidatos en sus fuentes, solo lectura:
`C:\Unreal\MyProject\Content\BigNiagaraBundle\NiagaraWeather\StatickMesh\SM_Leaf.uasset`
(101.110 B), `Materials\M_Leaf_8.uasset` (86.425 B), `Textures\T_Leaf_1.uasset` (2.595.733 B) y
`T_Leaf_8.uasset` (2.946.975 B). El inventario clasifica por extensión, sin confirmar clases/dependencias;
no hay preview del mesh de hoja ni evidencia de una planta baja estática. Sigue como candidato para
inspección futura, sin exportarlo. `SM_Tree_Green_01` (289.283 B), cuya preview S05 muestra árbol frondoso,
no resuelve raíces de palma. `Grass_LayerInfo` (1.566 B) es dato de capa; Interactive Pandanus Plants
no fue localizado por ese nombre. No se altera `C:\Unreal`.

Decisión: raíces propias de bajo coste con la corteza S05 existente; dos hojas individuales del atlas
original para plantas bajas. Se reutilizan los shaders S05 de color/contorno/sombra, recorte y viento.

## Contrato del corte

- Dos variantes de base, abierta/frondosa, dos partes raíces/hojas. Presupuesto máximo 600 triángulos
  y 80 KiB por GLB, sin imágenes embebidas. Raíces rígidas; flex de hojas desde cero en su nacimiento.
- Color y normal de hojas en atlas horizontal 2×1: PC 512×256, móvil táctil 256×128. Recortes fuente
  `[384,746,76,137]` y `[680,1024,48,117]`. Gutter 8/4 px, contenido 240/120 px; mismo UV y alpha
  en los dos canales. Normal de dato lineal a fuerza 0,16; coincidencia visual, bake no certificado.
- Raíces con UV del cuadrante corteza de S05; reutilizan su par cargado, sin otra textura de madera.
- Máximo global 144 bases, seleccionadas por hash de coordenadas/semilla del renderer y ordenadas por
  rango. Solo alrededor de palmas existentes en arena/hierba, terreno suave y casi plano bajo la huella.
  Rechazo de agua, muelle, caminos, zonas volcánicas, props próximos y accesos de tutorial/NPC.
  Altura, orientación y escala de la palma gobiernan la base; inclinación al terreno solo de la base.
- Sin cambios de RNG, props, colisión, simulación, recogida o persistencia. Bases cosméticas fuera del
  collider actual del tronco; no se convierten en obstáculos ocultos.
- Modelo ausente/inválido: geometría nativa con UV. Albedo perdido: hojas geométricas de color,
  sin rectángulos opacos. Normal perdido: conserva pintura. Noassets: fallback nativo completo.
- Fuentes/recibos y derivados con hashes, snapshots nuevos S06. Los snapshots históricos S01–S05
  conservan sus bytes; no se refresca la copia antigua de vegetation.js.

## Aceptación local

Geometría, orientación de normales, UV, carga/fallback, colocación estable y exclusiones con pruebas.
Capturas reales PC/móvil/low, muestrario temporal separado 1×, contacto con arena, normal y viento;
comprobar URL/resolución realmente cargada, errores JS/GL, programas enlazados y cinco fallos.
Registro de dos filas específicas, previews, modelos, fuentes y entrega descargables en HTML.
Arte fino, controles y FPS físicos y publicación quedan pendientes.
