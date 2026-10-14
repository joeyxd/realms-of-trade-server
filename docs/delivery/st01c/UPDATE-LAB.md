# ST01c — evolución local y fichas para autoría

Este documento conserva el checkpoint `ba0f4cc`. El [corte posterior](NATIVE-LAB.md)
añade un generador desde fuente; no reescribe las entradas o pruebas históricas de este modo.

2026-10-13. Laboratorio privado; sin alta nueva en el catálogo del juego.

El modo **Evolución local · nacimientos originales** ya calcula en JavaScript vida,
muerte, posición, curva de alfa y SubUV. Lee 50 estados iniciales con su tick de entrada;
no carga los 241 frames de partículas posteriores. Los nacimientos siguen siendo los
primeros estados observados después del spawn interpolado de Unreal. No es todavía un
generador propio ni una conversión de Niagara.

[Abrir localmente](http://127.0.0.1:5197/tools/niagara-native-lab/index.html?run=reference11&mode=update).
Se conserva el modo observado para aislar material y comparar. [Preparación y comandos](../../../tools/niagara-native-lab/README.md).

## Comprobación de actualización

Se fijaron tolerancias antes de ejecutar el cotejo en el [brief](../../briefs/st01c-niagara-native-fidelity.md).
`reference11` y `reference12`: 241 ticks, 4.140 estados de partículas por ejecución,
mismos IDs vivos y mismo orden en ambos emisores. Los estados de nacimiento son entradas,
por lo que esta prueba mide evolución posterior, no la equivalencia de la inicialización.

| Campo | Error absoluto máximo |
|---|---:|
| Posición, edad, tamaño, RGB y SubUV | 0 |
| Alfa | 0,0000008941 |

Se usa float32 a 1/60 s y velocidad constante, como en este piloto sin fuerzas activas.
El humo toma su alfa de los 54 valores del `ShaderLUT` del dueño activo, sin copiar la
curva heredada. La fuente instalada UE5.8 `NiagaraDataInterfaceCurve.cpp` confirma lookup
lineal con tiempo normalizado y clamp; `CurveBase` activa LUT por defecto. La curva
serializada redondea a seis decimales, lo que limita la comparación. El cero en otros
campos se refiere a estas dos ejecuciones concretas, no a cualquier Niagara.

Las capturas del modo local frente al modo observado en Three, a 2 s y tres cámaras,
dan píxeles idénticos en frontal/lateral; oblicua cambia un píxel por un nivel RGB8.
Esto verifica la sustitución de la actualización. **No elimina las diferencias previas
frente a Unreal** en color final/material ni establece calidad AAA universal.

Evidencia: [validación y hashes](update-checkpoint.json), [frontal](update-front.png),
[oblicua](update-oblique.png), [lateral](update-side.png), [humo rápido](update-fast.png),
[controles a 390 px](update-mobile.png). Capturas inspeccionadas.

## Ajustes disponibles

- Velocidad del humo: 0–2× sobre su velocidad inicial observada. Cambia el ascenso;
  conserva densidad, vida y la llama. El diminuto avance previo al primer estado
  observado no se reconstruye; el multiplicador actúa desde esa entrada a la fixture.
- Vida del humo: 0,25–4 s. Modifica muerte, progreso del atlas y curva; alarga su
  recorrido y puede aumentar la ocupación. No valida aún una variante móvil.
- Emitir hasta: 0–4 s. Filtra nacimientos posteriores a ese tiempo y deja terminar
  las partículas vivas; la vista llega a 8 s. Es un control del laboratorio, no una
  prueba de la desactivación original de Unreal. Restaurar devuelve los tres defaults.

Cinco pruebas CPU pasan: saneado/aislamiento del renderer, determinismo al buscar hacia
delante/atrás, entradas inválidas, velocidad/vida/parada, independencia y restauración.
Chrome pasa los flujos de ambos modos, tres vistas, cámara, capas, reproducción, controles,
390 px sin overflow y liberación de GPU (0 geometrías/texturas). El modo local realiza
17 solicitudes y ninguna carga de frames completos; todo GET a localhost y cero errores.
No hay medida de FPS físico ni cambio al bundle, juego, SQL, protocolo o servidor.

## Catálogo para el futuro agente

La [ficha estructurada](effect-description.json) registra una descripción revisada de la
llama/humo, etiquetas con procedencia, atlas/capas, parámetros y consecuencias, controles
experimentales, presupuesto conocido y datos pendientes. Los roles sugeridos se distinguen
de capacidades comprobadas; no describe esta llama como un proyectil de tierra ni un aura.

La [visión del taller](../../briefs/skill-studio-vision.md) incorpora el encargo del autor:
recuperar fichas textuales, escoger iconos/animaciones y componer borradores de habilidades.
ST02/ST03 implementarán ese flujo sobre IDs/revisiones y esquemas cerrados, separado de
las reglas del servidor. No se ejecutó un modelo ni se crearon habilidades nuevas aquí.

## Qué sigue

Cerrar las distribuciones y ramas efectivas de SphereLocation/CylinderLocation, el uso
de Lathe Profile, interpolación de spawn y la política de semilla. Se exportaron en scratch
cinco módulos y cuatro funciones concretas; quedan ramas sin resolver, por lo que no se
inventó un generador uniforme para reemplazarlas. Después sustituir la fixture de nacimiento,
contrastar la secuencia, DepthFade/color final y presupuesto antes del Taller.

Los 51 originales de `C:\Unreal\MyProject` y sus copias conservan los hashes registrados.
Las exportaciones fueron consultas de lectura sobre el proyecto aislado con NullRHI.
No se guardaron assets fuente. La biblioteca restante y el UI Workshop siguen en su plan.
