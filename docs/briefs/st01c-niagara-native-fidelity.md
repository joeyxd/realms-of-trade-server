# ST01c — adaptador Niagara de partículas 3D

**Estado, 2026-10-13: extracción y laboratorio privado de material con partículas 3D observadas.**
[Referencia/comparación](../delivery/st01c/RENDER-LAB.md): ejecutar y fotografiar Unreal,
reproducir sus atributos en Three y aislar el procesamiento de color. La simulación
propia y la aceptación final siguen pendientes. No habilita sistemas en el juego ni
cambia el registro de ST01b.

El autor eligió avanzar por extracción directa y adaptación gradual, apuntando a una calidad
cercana al original, y reconsiderar la ruta si exige un esfuerzo desproporcionado. Este primer
corte se limita a `NS_Flame_Single` de MyProject: demostrar acceso a valores, curvas y materiales
antes de escribir un simulador. No se compromete una conversión automática ni un calendario
para las 916 identidades. REA queda como herramienta opcional para preguntas concretas sobre
comportamientos inaccesibles; no es una dependencia de este piloto.

La decisión de seguir requiere un manifiesto trazable con los dos handles efectivos y sus
versiones, módulos conectados, parámetros tipados/curvas y gráficos de material. Si solo obtenemos
nombres, defaults parciales, buffers opacos o dependencias sin semántica, registramos ese límite
y revisamos el alcance antes de invertir en un port. La equivalencia visual requiere después
referencias multiángulo y un prototipo 3D; la extracción por sí sola no la acepta.

## Objetivo

Acercar cada adaptación al Niagara original que permitan las fuentes y Three.js. Para un sistema seleccionado, portar sus emisores y materiales como una simulación de presentación 3D: conservar sus texturas y canales, capas, secuencia de spawn, vida, movimiento y silueta desde varias cámaras. La secuencia debe poder repetirse para comparar con Unreal. Si falta un módulo, textura o ajuste que cambie el resultado, el sistema sigue pendiente con ese motivo; no recibe un efecto genérico parecido.

El navegador no ejecutará Niagara ni sus Niagara Data Interfaces. El runtime usa Three.js 0.160.0. El adaptador implementaría, con código local y paso temporal fijo, el subconjunto de módulos que se extraiga del sistema original. Los materiales Niagara se traducirían a shaders Three.js solo cuando su uso de canales, alfa, color/emisión y blending pueda contrastarse con la referencia. Diferencias de shader o funciones sin equivalencia se registran como bloqueos, no se tapan con un material estándar.

## Selección inicial basada en evidencia

**Piloto de este corte: `NS_Flame_Single` de `MyProject`**, identidad `niagara-985a431dc6c0d1ca`, SHA-256 `985a431dc6c0d1ca1c43a31765754bae7cc78b853ca1fcadc1fa3fd093ec2165`, paquete `/Game/sA_Megapack_v1/sA_StylizedAttacksPack/FX/NiagaraSystems/NS_Flame_Single`.

El cierre de dependencias registra dos emisores (`NE_Flame_Basic_001`, `NE_Smoke_Basic`), 41 paquetes, tres materiales y cuatro texturas. La enumeración SubUV anterior incluía objetos heredados y no probaba el renderer efectivo. El extractor C++ de este corte resuelve las versiones usadas por los dos handles: **un renderer de llama con `MI_Flame_2` y otro de humo con `MI_Smoke_1`**, ambos CPU y habilitados. No sumar las copias de padres ni tratar `MI_Flame_1` como otra capa activa. Hay candidatos de atlas para `T_FlameUV_1` y `T_FlameUV_2` (8×4, 32 celdas cada uno) y `T_Smoke_1` (10×6, 60 celdas); solo los dos últimos están asignados a esos renderers efectivos. El cierre reporta spawn burst/rate, localización esférica/cilíndrica/de sistema, velocidad, solver, color, vida y SubUV; esa lista no prueba qué módulos ejecuta cada uso.

Existe una exportación PNG segura de `T_FireBall` (SHA-256 `6be3a6e443561c262ff7e992758059d01068da88b78254af3a6379d807be0a1c`), fuera del bundle del juego. El gráfico exportado confirma que es el valor por defecto de `SUBUV` en `M_Smoke`; las instancias lo sustituyen por sus atlas. El padre compartido es un material translúcido/unlit de seis expresiones: RGB de textura y color por partícula para emisión; máscara por alfa, clamp y DepthFade para opacidad. Se leyeron los defaults 0–1 del clamp, 100 cm de DepthFade y la interpolación SubUV del material. La traducción de canales, coerciones, unidades y comportamiento de profundidad todavía necesita contraste visual. No se descarta ni reemplaza ninguna textura.

No se deben agrupar identidades solo por nombre o ruta: el catálogo contiene otro `NS_Flame_Single` en `SimpleMultiplayerSurvival` con distinto SHA-256 (`4e2ad705daafa1bfc65b3b09a80bfbb700696aa435f363337689912b197153f4`). Este piloto queda ligado a la identidad MyProject, sus hashes y sus renderers exactos.

**Segundo candidato, condicionado y posterior:** `NS_BasicHit` de MyProject, identidad `niagara-97a82bae61b29237`, SHA-256 `97a82bae61b292371a78cadc6ffef2f7dcae3ea39ac0a9ccb6b5ed2ee57e18cf`. Su cierre de 58 paquetes contiene tres emisores, cuatro materiales y cuatro texturas; la dependencia registrada incluye spawn burst/rate, localización esférica/de sistema, velocidad desde punto, gravedad, drag, vida, tamaño y SubUV. Es una referencia útil para una ráfaga multicapa con origen reproducible. Sus ajustes y la necesidad de entrada externa aún no están extraídos, y tampoco están exportadas/revisadas todas sus texturas. No es reemplazo ni fallback del piloto: permanece pendiente hasta superar los mismos gates.

## Identidad y límites del registro

ST01b conserva las identidades de componentes seleccionadas como entradas independientes de biblioteca. La investigación mantiene 16 recetas candidatas; una receta no equivale a una aprobación ni al número de sistemas. Por ejemplo, los 18 sistemas que comparten SmokePuffLight conservan su propia identidad y estado pendiente hasta tener adaptación o captura propia. Un renderer compartido enlaza componente, textura y sistema por hashes y ruta exacta; no transmite el estado `ready` de la textura a sus sistemas.

Añadir un rol versionado, por ejemplo `native-port`, separado de `source-texture`, `system-capture` y `recreated`. Su descriptor señala una identidad de sistema y SHA exactos, dependencias/materiales, versión del adaptador, módulos soportados y limitaciones. Nunca reutiliza la duración editorial de un atlas como duración original. Los ajustes editables se limitan a parámetros que existan en el sistema fuente y se hayan comprobado; cantidad de partículas no se inventa como control de usuario.

La simulación vive solo en el escenario privado de vista previa. Usa un reloj fijo, semilla local reproducible y su propia lista de partículas; no consume el RNG del mundo ni accede a `src/sim/**`, cuerpos, combate, comandos, progreso o escritura de red. Un evento de juego o una interacción futura necesita un diseño autoritativo separado.

## Referencia de Unreal y extracción previa al código

Trabajar sobre una copia aislada de los proyectos y paquetes; mantener `C:\Unreal` en solo lectura. Para el piloto, extraer y registrar:

- SHA del sistema, cada emisor, material y textura; asignación de emisores y orden/capas; estado, espacio local/mundo y orientación de cada renderer.
- Valores serializados de todos los módulos: spawn inicial/continuo, cantidad y distribución, ubicación, velocidad, vida, tamaño, color, rotación, fuerzas, drag, límites/culling, semillas y curvas; parámetros del sistema, colección Niagara o Blueprint si los hubiera.
- En cada renderer SubUV: textura, canales y sampler, grilla, modo de lookup, tasa/loop/fase y asignación de material. Verificar el hash de la exportación `T_FireBall`, inspeccionar el grafo de material que la consume y volver a exportarla solo si difiere del source hash.
- Referencia transparente y en fondo controlado a 60 pasos por segundo, desde una activación y semilla fijadas; timestamps de inicio, expansión/pico, decaimiento y final. Capturar cámara frontal, oblicua y lateral, con misma escala y exposición, además de los hashes de escena/configuración. La lectura se pausa durante la captura de cada frame; no reiniciar el sistema y presentar los frames como una animación continua.

La auditoría existente de renderer-grid confirma ownership y `SubImageSize`, y las recetas contienen candidatos de textura; no contiene esos valores de simulación ni una referencia visible del sistema. La duración de 2 s que usan las recetas es editorial. WaterSplash depende de un contexto spline: su textura 7×7 no sustituye ese contexto ni las otras capas del sistema.

## Adaptación propuesta

Una versión `native-port-v1` tendría emisores independientes con arrays de atributos actualizados a paso fijo y renderizadores de sprites/meshes Three.js, según el renderer real. Los quads conservan orientación y tamaño del original; UV/frame, color/emisión y alfa siguen el material extraído. Un shader propio se añade por material cuando el grafo fuente lo requiera. Las capas no se fusionan en un flipbook y las partículas mantienen posiciones distintas en 3D, de modo que la cámara pueda parallaxearlas.

El puerto implementa solo módulos cuyos parámetros y orden estén extraídos. Las ubicaciones esférica/cilíndrica, burst/rate y las curvas son candidatos explícitos del piloto; su semántica y valores deben confirmarse en los emitters, no inferirse del nombre de módulo. Cualquier Niagara Data Interface, colección de parámetros, evento, colisión, mesh, renderer o función de material sin traducción verificada mantiene el adaptador bloqueado hasta diseñar esa entrada concreta.

## Comparación, móvil y gates

La comparación usa las mismas cámaras, timestamps, exposición, escala y semilla en Unreal y navegador. Revisar secuencia y capas, no una captura aislada: color por canal, máscara/silueta, centro y extensión por capa, trayectoria, orden temporal, densidad y duración. Una revisión visual independiente confirma que no aparezcan huecos, halos, cambio de alpha, clipping ni pérdida de movimiento al girar la cámara. El criterio de aceptación y sus tolerancias se acuerdan sobre las referencias antes de escribir el port; el catálogo o un test de contrato no pueden aceptarlo por sí solos.

Medir móvil por separado: coste de actualización por partícula, geometría/instancias, draw calls, tamaño de texturas, overdraw de capas transparentes y tiempo de GPU en dispositivo. Conservar cantidades y movimiento de partículas al optimizar. Si no cabe en el presupuesto, el resultado queda limitado o pendiente por dispositivo hasta encontrar una optimización que mantenga la referencia; no baja a un stand-in genérico ni reduce densidad sin aprobación expresa.

Antes de código: cerrar los exports y settings del piloto, referencia Unreal multiángulo, canales/materiales y límites; cerrar la correlación entre el material y la exportación `T_FireBall`; definir el esquema `native-port-v1` y el criterio visual por cámara. Después, pruebas deterministas de parámetros/tiempo/semilla, errores y liberación de recursos, cancelación por epoch, aislamiento del escenario, selección de calidad, y cero escrituras o mensajes de gameplay. La aceptación de interfaz/móvil emulado y la medición en dispositivo son gates separados.

## Evidencia consultada

- [Brief ST01b de biblioteca y conversión](st01b-niagara-library.md).
- [Resumen del censo y límites de la consulta UE 5.8 NullRHI](../research/unreal-assets/st01b/README.md).
- [Cierre y dependencias de MyProject](../research/unreal-assets/st01b/myproject-dependencies.json) y [cadenas de componentes/renderer](../research/unreal-assets/st01b/source-component-candidate-chains.json).
- [Estado de exportación de texturas](../research/unreal-assets/st01b/grid-texture-export-manifest.json) y [calidad de candidatos](../research/unreal-assets/st01b/source-component-frame-quality.json).
- [Contrato actual de preview privado](../../src/render/skillPreview.js); Three.js 0.160.0 fijado en [package.json](../../package.json).

## Checkpoint de extracción, 2026-10-13

[Entrega y evidencia](../delivery/st01c/DELIVERY.md). Unreal 5.8 ejecutó las consultas Python
y el helper C++ en una copia aislada, con NullRHI. Se resolvieron dos versiones efectivas,
dos renderers y 100 registros de parámetros de rapid iteration (80 nombres únicos, ocho
stores). Todos los registros se contrastaron por nombre/offset/bytes con el T3D y se
decodificaron por el tipo real, no por índices de registro inferidos.

Los ocho usos tienen una cadena de mapa de parámetros trazada por sus conexiones; la
auditoría conserva módulos desactivados sin tratarlos como candidatos ejecutables. Eso
no evalúa los módulos ni cierra todas las entradas dinámicas/curvas ni el estado global
del sistema. Los 51 archivos fuente y sus copias conservaron sus hashes después de las
consultas. No se ejecutó Niagara, navegador ni GPU: la extracción de fuente queda probada;
la equivalencia visual, simulación 3D, densidad editable y rendimiento siguen pendientes.

Decisión: continuar únicamente con el prototipo de este piloto y su comparación. La
existencia de datos accesibles y un material común justifica ese experimento; no permite
estimar aún el esfuerzo para toda la biblioteca. Si exige módulos/interfaces o un
renderer desproporcionados para mejorar una sola familia, reconsiderar antes de ampliar.
