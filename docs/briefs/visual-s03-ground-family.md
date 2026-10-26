# S03 — hierba, tierra y transiciones pintadas

El autor añadió cuatro pares de albedo/normal y pidió registrarlos y aplicarlos al mapa.
Continuación visual de S01 arena y S02 rocas, con arte ilustrado moderno y lectura desde cámara de juego.

| Par recibido | Aplicación |
|---|---|
| Transición arena–pastizal | Banda de playa a hierba según el peso de hierba existente |
| Arena y tierra compactada | Borde de sendero y suelo transitado del pueblo |
| Hierba tropical | Superficie de hierba, con las matas pintadas del autor |
| Tierra seca con piedras y conchas | Interior de senderos y alrededor de la plaza |

Los degradados tienen arena abajo/izquierda y hierba/tierra arriba/derecha. Se proyectan a escala
mundial de 8 unidades y su influencia se adapta a la máscara de playa/sendero. No se estira toda
la lámina en una banda estrecha: esa primera prueba producía franjas. El avance transversal y un
seno continuo desplazan la textura suavemente hasta 0.15 del tile. Color y normal comparten coordenadas;
las normales de las transiciones se orientan por sus derivadas hacia la base del terreno.

Se reutilizan el renderer toon, la arena elegida, las máscaras, la plaza central y las fuentes aportadas.
El cruce Unreal/FAB consulta los candidatos ya revisados en S01: gravel Megascans y
`T_Sand_M_00` no encajan con esta pintura; el inventario no aporta un par hierba/tierra revisado
que sustituya estas imágenes. `SM_Rock` aporta geometría de S02, no este material. Fuentes Unreal intactas.

No se cambia la generación del mapa ni su clasificación física. Arena de combate, lava, volcán
y taludes conservan precedencia. Una pequeña plaza de piedra se conserva dentro de 4 unidades del
centro de Aldea Coralina y se mezcla hasta 7; senderos y suelo circundante usan los materiales nuevos.

Cuatro pares en dos atlas acolchados mantienen acotado el número de samplers. PC: atlas 2048 con
contenido 960 por material; móvil: atlas 1024 con contenido 480. Los PNG completos y previews
1024/512 quedan fuera de las peticiones del juego. Normales lineales, WebP sin pérdida, intensidad
moderada compartida de 0.22; normales de contorno geométricas. Fallback procedural al faltar color;
color sin normal sigue funcionando sin relieve nuevo.

Verificar archivos/SHA, geometría idéntica, atlas y selección por dispositivo, shader real dentro
del límite de samplers, capturas de playa/sendero/pueblo/arena y fallo de albedo/normal.
La revisión artística fina, repetición en distintas vistas y FPS en dispositivo físico siguen abiertos.
