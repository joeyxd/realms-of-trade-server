# Niagara — adaptación acumulativa y ejecución determinista

Dirección del autor, 2026-10-14: aplicar lo aprendido en cada efecto al siguiente,
hasta que una nueva familia requiera principalmente extracción, configuración y
verificación de sus diferencias. Este documento fija el diseño; no implementa todavía
un compilador general ni cambia el siguiente corte de ST01c: atlas y presupuesto.

## Resultado buscado

Cada port deja tres productos reutilizables: módulos con semántica comprobada,
fixtures y herramientas de comparación, y una ficha textual de comportamiento y
controles. El siguiente port los consume por versión, en vez de copiar el simulador
del anterior y cambiar nombres. Las peculiaridades del efecto quedan en datos;
el código nuevo se reserva para capacidades que realmente falten.

La meta es conservar la calidad del original y reducir trabajo repetido. Cada sistema
sigue necesitando identidad, parámetros y comparación propios: compartir una textura,
nombre de módulo o familia no demuestra que su comportamiento sea equivalente.

## Punto de partida comprobado

El laboratorio actual está especializado en MyProject `NS_Flame_Single`. Su validación
fija dos emisores, tasas, orden de llamadas aleatorias, formas y comportamiento exactos.
Es una base para extraer módulos comunes; aún no interpreta recetas Niagara generales.

| Pieza existente | Reutilización que debemos extraer | Límite actual |
| --- | --- | --- |
| [Simulación nativa](../../tools/niagara-native-lab/native-simulation.js) | RNG entero, redondeo float32, emisión por tasa, activación y nacimientos dentro del tick | Ramas fuego/humo; no hay ejecución de burst ni fuerzas |
| [Curvas y evolución](../../tools/niagara-native-lab/update-simulation.js) | Muestreo de LUT, edad, movimiento y atributos derivados | El modo histórico parte de nacimientos observados; no usarlo como generador nativo |
| [Partículas](../../tools/niagara-native-lab/particles.js) | Atributos validados, conversión de coordenadas y sprites instanciados | Formato y dos emisores del piloto; no acredita meshes o ribbons |
| [Profundidad](../../tools/niagara-native-lab/depth-stage.js) | DepthFade y pase opaco independiente | Perfil de material/cámaras contrastado; no es colisión |
| [Color](../../tools/niagara-native-lab/film-color.js) | Transformación Filmic SDR y LUT desde fuente | Perfil neutro fijado; bloom/grading libre y otros dispositivos requieren comparación |

La evidencia vigente está en [nacimientos](../delivery/st01c/NATIVE-LAB.md),
[profundidad](../delivery/st01c/DEPTH-LAB.md) y [color](../delivery/st01c/COLOR-LAB.md).
Un módulo detectado en dependencias o desactivado en el grafo no cuenta como implementado.

## Dos contratos deterministas

El procesamiento del asset y la ejecución de partículas son contratos distintos.
API conceptual para la implementación futura, **no disponible hoy**:

```js
// Reject unsupported capabilities with explicit diagnostics before execution.
const plan = buildEffectPlan(sourceIR, capabilityRegistry, qualityProfile);
const state0 = initializeEffect(plan, seed, initialInputs);
const state1 = stepEffect(plan, state0, tickInputs);
renderEffect(plan, state1, viewContext);
```

`sourceIR` es una representación intermedia declarativa, obtenida de la fuente efectiva.
Incluye identidad/hash, engine/backend, handles/versiones de emisores, orden de fases y
módulos activos, tipos, unidades/espacios, valores, bindings y curvas. Conserva entradas
externas, interfaces y operaciones desconocidas como requisitos explícitos. No contiene
JavaScript/GLSL arbitrario del autor ni partículas capturadas para simular nacimientos.

El plan fija revisiones de módulos/materiales, política numérica, paso temporal y límites.
El perfil de calidad declara sus variantes de textura/render y ajustes aceptados;
no reduce densidad ni altera movimiento silenciosamente para cumplir un presupuesto.

`stepEffect` recibe todo lo que pueda influir en ese tick: índice, parámetros y eventos
ordenados, transforms/anclas e interfaces externas que el plan haya admitido. Conserva
en el estado IDs, edades, resto de emisión, ciclos y estado/contadores de RNG. Mismo plan,
semilla e historial de entradas producen el mismo resultado dentro del backend fijado.
Sin reloj real, `Math.random`, red ni RNG del mundo. Reproducir más lento cambia el ritmo
de visualización, no el paso de simulación. Un cambio de control registra si reinicia
la secuencia o aplica desde un tick; nunca depende de cuándo llegue un frame del navegador.

El orden spawn/update, microticks, nacimiento interpolado, muerte y consumo de aleatoriedad
son parte de la semántica del módulo, incluso si una llamada no afecta al material visible.
No imponer el orden del piloto a una familia diferente. Float32, estimaciones VM y orden de
operaciones se versionan; no se promete igualdad binaria entre CPU, GPU y navegadores.
Las tolerancias contra Unreal se fijan antes de comparar y se registran por campo/perfil.

La transición es pura en su contrato. Una implementación eficiente puede usar buffers
propios, siempre que no altere un snapshot retenido ni tenga estado oculto que cambie el
replay. Reset, avance y seek con el mismo historial deben coincidir. Cámara, profundidad,
exposición y recursos GPU viven en `viewContext`; renderizar no avanza ni cambia partículas.
Una futura colisión/evento que sí afecte partículas necesita su entrada y módulo propios.

## Proceso repetible por efecto

Una herramienta de orquestación ejecutará estas etapas y podrá continuar desde el último
resultado válido. Cada salida registra hashes de entradas, versión de herramienta/módulos,
comando, configuración y resultado. Un cambio de fuente, binding, módulo, material o perfil
invalida las salidas dependientes; no todo el inventario ni una aceptación ajena.

| Etapa | Entrada y salida revisables |
| --- | --- |
| 1. Seleccionar | Ruta e identidad exactas del inventario existente; cierre/hash de dependencias y copia aislada. Fuentes Unreal intactas |
| 2. Extraer | Handles/versiones efectivos, fases, conexiones activas, stores tipados, código efectivo, curvas y grafos de material; diagnóstico de datos ausentes |
| 3. Normalizar | IR canónica con unidades, orden, defaults, binding de entradas externas y procedencia por valor |
| 4. Resolver capacidades | Registro versionado: módulos reutilizados, diferencias semánticas y capacidades faltantes. Si falta una operación, detener ese port con un motivo concreto |
| 5. Ensamblar | Plan de ejecución sobre módulos compartidos; implementación nueva solo para el requisito faltante, con fixture propia antes de admitirlo |
| 6. Contrastar | Referencia UE y replay local con misma semilla, entradas, tiempos, cámaras y perfil; comparación numérica/visual y regresión de los ports previos |
| 7. Presupuestar | Derivados de atlas, selección real de variante, bytes/memoria, CPU/GPU y overdraw por dispositivo; comparación visual de cada variante |
| 8. Catalogar | Descriptor de módulos/controles, ficha textual, límites y evidencia; estado privado hasta los gates de integración/publicación del taller |

Las capturas son oráculos de validación, no entradas del generador ni tablas ajustadas
para ocultar diferencias. Repetir extracciones/planes debe conservar la representación
canónica; capturas GPU se juzgan según su perfil y tolerancias. Para PNG, comparar píxeles
decodificados: compresión lossless distinta puede cambiar el hash del contenedor.

## Qué debe quedar aprendido tras cada familia

El registro de capacidades identifica operación y **versión semántica**, tipos admitidos,
fase, bindings, espacios, defaults/rangos, consumo RNG, política numérica, dependencias y
fixtures. Dos grafos con el mismo nombre pueden necesitar versiones distintas. Una mejora
del módulo se contrasta con los efectos que ya lo usan; sus recetas anteriores quedan
fijadas a la revisión aceptada hasta una migración explícita.

Cada entrega añade una matriz: capacidad requerida → reutilizada/nueva/no soportada →
evidencia. Registra cuántos módulos compartió, qué código específico quedó y qué partes
fueron manuales. Así podremos comprobar si el coste por nueva familia disminuye, en vez
de llamar automatización a scripts que aún requieren rehacer el efecto completo.

Las pruebas pequeñas cubren semántica y casos límite del módulo; las referencias completas
siguen protegiendo orden, interacción y aspecto del sistema. No repetir investigación ya
cerrada si sus fuentes/revisiones coinciden, ni omitir una comparación por tener piezas
compartidas. Un error deja diagnosticado el primer requisito divergente, sin un efecto
genérico de sustitución que aparente una conversión correcta.

La [ficha legible por agentes](skill-studio-vision.md) consume estas mismas capacidades:
descripción visual observada, roles/anclas comprobados, controles y consecuencias,
duración/ciclo/parada, presupuesto y procedencia. El futuro agente busca y combina recetas
registradas y produce borradores; no vuelve a inferir cada control de una imagen ni concede
daño/estados por elegir un efecto. El compositor sigue en ST02/ST03.

## Orden de implementación y aceptación de reutilización

1. Cerrar atlas/variantes y presupuesto del piloto según el [brief ST01c](st01c-niagara-native-fidelity.md).
2. Extraer gradualmente sus primitivas contrastadas a módulos comunes, conservar la receta
   exacta y demostrar que los checkpoints numéricos/visuales anteriores no cambian.
3. Usar una familia diferente para probar el contrato. `NS_BasicHit` exacto de MyProject,
   ya censado en ST01c, es candidato: todavía necesita extracción de ajustes y referencia.
   Burst, gravedad/drag y otras operaciones solo se añadirán si su fuente efectiva las requiere.
4. Pasar más sistemas compatibles por el mismo flujo; ampliar capacidades únicamente ante
   un requisito verificado. Integración al taller y publicación mantienen sus gates propios.

La primera prueba de reutilización se acepta cuando otro sistema usa los módulos comunes
sin copiar ramas fuego/humo ni duplicar sus fórmulas, sus diferencias quedan en IR/bindings
o módulos nuevos contrastados, y ambos sistemas mantienen sus comparaciones. El diagnóstico
de una capacidad ausente, el replay determinista, la invalidación de evidencia y la ficha
textual forman parte de esa entrega. El registro general, CLI y formato definitivos siguen
pendientes de implementación; este plan no los presenta como herramientas ya disponibles.
