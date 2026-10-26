# D08a.1 — navegación arcade y lectura de velocidad

2026-10-06. Base de código y regresión: `0024900da89dcedc2f7789280919336c04b596a6`.
Revisión final añade `f7bdee5` (solo HUD vertical CSS) y `f6dce6e` (profundidad de efectos de superficie).
[Brief y reutilización FAB](../briefs/d08a-arcade-navigation.md).

## Resultado jugable

La bahía local ahora combina manejo más rápido, dos corredores de corriente y una captura de vela
con timing. Sigue siendo un laboratorio independiente: no hay pilotaje online, colisiones navales,
cubierta móvil ni mercancías reales. El código no activa migraciones ni hooks de perlas.

Abrir `PROBAR-NAVEGACION.cmd` o ejecutar `node tools/naval-lab.mjs` y visitar
`http://127.0.0.1:5180/`. W/RT avanza, A/D o stick gira, S/LT frena, Espacio/A o botón captura.
Crucero asistido mantiene avance básico y se puede apagar. Escape pausa; blur/ocultación limpia entradas.

- Corrientes: el agua arrastra mediante velocidad relativa y bordes suaves; flechas y campo comparten
  descripciones. Son dos corredores fijos del experimento, no rutas cambiantes implementadas.
- Vela: aviso 3 s antes, ventana de 1,5 s, una oportunidad por ráfaga y 5,5 s de fuerza extra al acertar.
  El centro recompensa más. Orientación, vela abierta y freno importan. Fallar no quita avance.
- Tacto: mayor empuje/timón y recuperación lateral; peso, altura y distribución conservan desventajas.
  Al acabar el boost se retira fuerza y la velocidad decae gradualmente, sin recorte instantáneo.
- Lectura del mar: flecks de espuma anclados al mundo, estela curva, spray lateral/proa y vela deformada.
  Durante boost se refuerza el spray, hay trazos de cómic periféricos y cámara 35–41° con inclinación
  hasta 1,43°. El casco inclina como máximo 11,5° y levanta ligeramente la proa. Sin sacudida de pantalla.
- Sonido: viento/agua cambian con la velocidad, tensión grave al girar y acentos aviso/ventana/captura.
  Se desbloquea por gesto, tiene silencio y pausa. Audio sintetizado provisional; falta audición humana.

«Efectos de cómic» apaga líneas/FOV/inclinación de cámara. Reduced motion omite esos efectos y el spray
continuo; conserva referencias estables, flechas distribuidas, texto y feedback mínimo de captura.
El lastre J conserva posición/movimiento al retirarse; aún no tiene recoil, botín ni costes.
Remolino, ancla, tripulación/ballast y rebotes quedan fuera de este corte.

## Presupuesto y reutilización

Atlas existente: una variante 1024 escritorio o 512 móvil, no ambas. Caja FAB ya importada de 204
triángulos, fallback procedural y geometrías existentes. Niagara/Blueprint y audio `.uasset` revisados
no son ejecutables directamente en Three; se conservan fuentes Unreal sin exportar/modificar.

Una malla de referencias con capacidad 338 flecks móvil / 722 escritorio, dos cintas de nueve muestras,
pool de spray 144/288, 12/20 paths SVG. Un ruido ambiente compartido por tres filtros y hasta tres
eventos simultáneos (cada uno puede tener tono y ruido). La finalización desconecta todos los nodos.
No se añadieron texturas, archivos de audio ni dependencias descargadas.

## Verificación

**52/52 pruebas pertinentes** sobre `f6dce6e` cubren manejo/carga, determinismo 30/60/120 FPS, agenda/captura única/expiración,
foco/multitáctil/mando, servidor aislado, anclaje/reciclaje de espuma, pausa, presupuesto y ciclo de audio.
Las pruebas de presentación comprueban límites, opt-out y limpieza; no demuestran que el tacto guste.
Regresión de `git archive 0024900`, 86 archivos, Node v24.14.0: **987/994; siete fallos** en red,
limpieza PC-host EPERM, procesos fresh de perlas y timeouts de servidor; no declarar verde global.
El archivo de red pasó 2/2 aislado con límite 60 s, compatible con presión del conjunto, sin demostrar
por sí solo una causa. [Evidencia](d08a-arcade-evidence.json) y TAP local conservan el resultado original.
Los otros cuatro archivos fallidos se repitieron secuencialmente, sin editar código ni ampliar su
entorno: PC-host 1/1, pearl-batch-process 3/3, same-holder-process 2/2 y server 5/5. Incluyendo red,
**13/13** en los archivos reintentados. Ningún fallo se reprodujo aislado; sensibilidad a la carga es
una inferencia. El resultado global original sigue siendo 987/994, no sustituirlo por «994/994».
Los followups visuales no cambian simulación/audio/entrada y fueron verificados con sus pruebas pertinentes
y compilación/capturas; no se repitió la suite completa por una línea CSS y la profundidad de superficie.

Comparación sin corrientes/ráfagas, viento a favor, avance 6 s; freno y giro arrancan a 2 u/s:

| Fixture | Velocidad a 6 s | Freno | Giro 90° |
|---|---:|---:|---:|
| Balsa ligera | 6,23 u/s | 1,03 s | 2,45 s |
| Carga centrada | 4,98 u/s | 1,67 s | 3,10 s |
| Carga en extremos | 4,98 u/s | 1,67 s | 7,27 s |
| Carga alta lateral | 4,98 u/s | 1,67 s | 6,00 s |
| Casa flotante 4×4 | 3,89 u/s | 2,27 s | 4,85 s |

Números experimentales, no balance definitivo. El viento permanece fijo durante el giro.

Revisión de navegador por `computer-use`: escritorio inicial y captura perfecta final con modo móvil.
En el segundo caso, tick 476: 10,99 u/s, multiplier 2,8, 20 partículas vivas/144, nueve muestras de estela,
251 flecks/338, doce trazos, FOV 40,46°, atlas móvil seleccionado y un solo burst de captura. El gesto
activó audio; contadores aviso/ventana/perfecto = 1/1/1; en pausa los buses quedan en cero.
Estos contadores no son una audición del sonido.

Captura de boost inspeccionada: `shots/naval-arcade-20261006/mobile-landscape-final.png`;
snapshot `.scratch/naval-arcade-mobile-final.json`. Se solicitó viewport 844×390, pero el capturador
entregó un bitmap 433×390 con escala/banda inferior anómala: evidencia visual provisional de boost.
Tras recuperar la conexión, DOM confirmó 844×390 y ausencia de overflow horizontal; la captura de
layout horizontal seguía con escala anómala, por lo que no se declara aceptada su reproducción.

Vertical: DOM confirmó 390×844, bay de 374,67×489,51 y ausencia de overflow horizontal. La captura
`shots/naval-arcade-20261006/mobile-portrait-final.png` muestra controles y mástil libres tras estrechar
el HUD. Se restauró el viewport normal. En `desktop-final.png` la corriente queda detrás del casco/vela:
el pipeline outlined no tiene depth hardware en FX, así que los MeshBasic/LineBasic de espuma,
corriente y estela ahora reutilizan `FXU/GLSL_FX_DEPTH`. Shader compilado en navegador sin errores;
7/7 pruebas de feedback tras esa corrección. Variante escritorio 1024 y móvil 512 verificadas.

Faltan tacto/audición y FPS en teléfono/mando físicos, comparación con barcos construidos grandes,
captura horizontal sin anomalía y red/predicción/cubierta. La demo pública y protocolo no fueron actualizados por
este corte. Antes de integrar pilotaje hay que cerrar esos gates y el camino autoritativo de carga.
