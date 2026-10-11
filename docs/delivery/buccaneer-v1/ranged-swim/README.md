# Bucanero a distancia y nado original

2026-10-11. Corte alpha.58, protocolo 57. [Diseño](../../../briefs/buccaneer-ranged-swim.md).

Izquierdo: pistola corta de latón, rápida, 0,20 s, 0,7 ATK y alcance de vuelo 18 u. Derecho:
pistola larga de acero, potente, 0,60 s, 1,5 ATK y 24,7 u. Recargas independientes, ambos botones
pueden mantenerse juntos; teclado J/K, mando RT/LT y dos botones táctiles usan las mismas acciones.
El sable conserva guardia. Elegir Bucanero sugiere pistolas al crear un perfil; equipo guardado prevalece.

Un impacto físico entre bala propia y proyectil hostil devuelve este último desde el choque en dirección
opuesta a su tangente 3D. Ambos devuelven parreables; solo el fuerte devuelve pesados. Un pesado consume
un tiro ligero y continúa; imparables y aliados conservan sus reglas. Barrido continuo, primer contacto
con terreno/obstáculo/entidad, propiedad del tirador, un retorno por bala y riposte limitado sin XP/chain
de excelente. Disparo predictivo y choque autoritativo; eventos y tombstones confirmados soportan replay.
El cooldown secundario se incluye en ECS/PLAYER_FIELDS; red añade dirección/impacto Y de Shots.

El mundo usa el clip `swim` original (5,708 s) en un rig independiente de 65 huesos mientras nada vivo.
Una copia runtime congela solamente el avance Z de Hips; posición/yaw siguen la simulación. Al salir
del agua o morir se restaura el rig de 15 huesos y las armas. Fallos recuperan nado procedural.
Se conservan flash, sombras y contornos; no cambia stamina/ahogo/colisiones. La ficha conserva idle.

Un solo GLB por dispositivo: desktop 2.060.204 B, móvil 1.489.124 B, incremento 94.844/94.840 B.
9.164 triángulos y texturas 1024/512 sin cambios. Fuentes, skin, IBM y ambos clips originales intactos;
la preparación repetida produce hashes idénticos. [Evidencia de assets](../../../art/buccaneer-v1/asset-evidence.json).

Verificación local: [CPU](CPU.md), 85/85 focales de combate/red/nado, 27/27 recheck, 19/19 assets y
39/39 catálogo. Conteos solapados. La suite general no está verde: se interrumpió tras fallos/esperas;
véase CPU.md. [Navegador real](acceptance.json): 20/20 comprobaciones en Chrome, escritorio y móvil
emulado; LMB/RMB y touch CDP reales, choque por PATTERN/eventos de red, loop completo, modelo por
dispositivo, salida/muerte/reentrada/fallo nativo. Capturas inspeccionadas. Aviso de nado y botón de
compañeros compactos evitan tapar el centro en horizontal. [Script](../../../../tools/qa-buccaneer-ranged-swim.mjs).

Publicación: pendiente de revisión/imagen/salud y entrada pública verificadas.
Sin SQL propio ni activaciones de persistencia. Balance y FPS en teléfono físico siguen pendientes;
tampoco se ha perfilado el peor caso de pools de proyectiles llenos.
