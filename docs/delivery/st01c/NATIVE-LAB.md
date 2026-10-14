# ST01c — nacimientos y evolución desde fuente

2026-10-13. El mismo piloto ya genera sus partículas en JavaScript desde constantes,
curva y semilla. El modo **Generador propio · mismo piloto** no lee estados iniciales
ni listas de nacimientos. Llama y humo usan posiciones 3D independientes y los materiales
anteriores. [Abrir el laboratorio local](http://127.0.0.1:5197/tools/niagara-native-lab/index.html?run=reference11&mode=native).

La entrega cubre las ramas CPU efectivas de MyProject `NS_Flame_Single`, SHA
`985a431dc6c0d1ca1c43a31765754bae7cc78b853ca1fcadc1fa3fd093ec2165`. Es un piloto
privado; DepthFade con suelo, color final Unreal, presupuesto físico e integración
al taller siguen pendientes. No convierte otros sistemas ni habilita habilidades.

## Fuente y decisiones

El helper C++ recompilado exportó diez registros de script. Seis contienen HLSL
CPU efectivo; los cuatro registros emitter spawn/update están vacíos porque sus
grafos viven en los scripts de sistema. `compiled02/report.json` y los textos están
fijados por hash en el preparador. Se conservaron las 51 fuentes y las 51 copias.

- Llama: punto uniforme en el volumen de una semiesfera superior, radio 0,192912 cm,
  offset Z 24,4857 cm. Tamaño uniforme 120–153,806 cm y RGB fuente por color aleatorio.
- Humo: cilindro de radio 23,9795 cm, Z uniforme ±1 cm, offset Z 30,8862 cm. El radio
  usa raíz cuadrada para distribución de área; tamaño 100–153,806 cm. La curva Lathe
  está enlazada pero **EnableLatheProfile=false**; SurfaceOnly=false. No deformar el
  cilindro ni añadir la banda superficial desactivada.
- RNG determinista de la fixture: mezcla entera de 32 bits y salida de 24 bits de
  `NiagaraEmitterInstanceShader.usf`, fuera de sus bloques exclusivos de GPU. Semillas
  por partícula: ID, tick de sistema y semilla del emisor. Llama consume tamaño/color/
  MaterialRandom antes de esfera (llamada 4); humo consume tamaño/MaterialRandom/dos
  salidas del helper de dirección antes de cilindro (llamada 5), incluso si la dirección
  se descarta en la rama efectiva. No usar RNG del mundo ni `Math.random`.
- SpawnRate acumula `rate*dt+remainder`, toma floor y conserva el resto. El primer
  update del sistema usa 0,0001 s (`NiagaraSystemSimulation.cpp`, update-on-spawn).
  `InterpStartDt=(1-resto)*reciprocal(rate)`. La edad inicial es el tiempo restante
  dentro del tick. El helper mide únicamente las constantes aritméticas del backend
  VectorVM Win64: 0,333251953125 y 0,0999755859375 para rates 3 y 10.
- La inicialización y evolución usan float32. ParticleState mata al alcanzar
  `lifetime-0,0001`, según el HLSL; después siguen velocidad constante, curva de alfa
  y SubUV por edad normalizada. El preset usa los literales compilados redondeados,
  no sustituye esos literales por valores authored de rapid iteration más precisos.

El preparador y simulador solo aceptan este preset revisado. El cargador valida su
SHA completo, y el constructor fija sus datos de comportamiento. Los rangos editables
se aplican como controles separados. [Preset](../../../tools/niagara-native-lab/pilot-source.json),
[código](../../../tools/niagara-native-lab/native-simulation.js),
[ficha textual para futura autoría](effect-description.json).

## Comprobaciones

Las tolerancias se fijaron en el [brief](../../briefs/st01c-niagara-native-fidelity.md)
antes del verificador. Las capturas solo se pasan a la comparación, nunca al simulador.
`reference11` y `reference12`: **241 ticks y 4.140 estados por ejecución**, mismos IDs
vivos y orden. Error máximo de posición 0,00000190735 cm; alfa 0,00000089407. Edad,
velocidad, RGB, tamaño, rotación, vida y SubUV coinciden en los campos cotejados.
Esto acredita la fixture de semillas 6371/6372; el original tenía determinismo apagado.

**9/9 pruebas CPU**, incluyendo continuidad a 7/8 s, seek/reinicio, otra semilla,
bounds y rechazo de fuente modificada. Chrome: **7 grupos de comprobaciones** del
nuevo modo, más regresión de actualización y observado. Sin errores ni tráfico de
escritura; el modo nuevo no solicita frames o nacimientos grabados. Capas/cámara/play,
controles y layout de 390 px comprobados; geometrías/texturas quedan en cero al disponer.

Las tres vistas a 2 s usan la misma presentación HDR. La comparación adicional
generador vs atributos observados usa el mismo renderer Three; no es una métrica de
equivalencia del tonemapper de Unreal. [Recibo y diferencias de píxeles](native-checkpoint.json).
Capturas frontal/oblicua/lateral, semilla 42, emisión a 7 s y móvil inspeccionadas.

## Controles y siguiente corte

Velocidad ×0–2, vida 0,25–4 s, emitir hasta 0–8 s y semilla 0–65534. La semilla de
llama es la elegida y la de humo es +1. Cambia distribución manteniendo densidad y
tiempos; variantes distintas solo están comprobadas localmente, sin captura UE propia.
El modo de actualización conserva su ventana/default de 4 s y configuración independiente.

Sigue probar interacción de profundidad en una escena controlada, cerrar presentación
de color y medir el presupuesto antes de integrar el piloto. El catálogo semántico
acompaña el port; composición por agente, iconos y UI Workshop permanecen en plan.
La memoria GPU de atlas completos sigue estimada en 30,7 MiB con mipmaps; layout móvil
emulado y pruebas locales no acreditan FPS físico, variante móvil o despliegue del juego.
