# ST01c — viabilidad de extracción Niagara

**Continuación, 2026-10-13:** [laboratorio de render y referencias ejecutadas](RENDER-LAB.md).
Ya existe reproducción privada de atributos 3D observados con material traducido;
la simulación propia y la equivalencia final siguen pendientes. El texto siguiente
conserva el checkpoint anterior de extracción.

El autor autorizó el piloto el 2026-10-13: avanzar gradualmente hacia una calidad cercana
al original y reconsiderar antes de invertir en una réplica extensa. Este corte prueba
la extracción directa de `NS_Flame_Single` de MyProject. **No contiene todavía un port
3D ni acepta equivalencia visual.** [Plan vigente](../../briefs/st01c-niagara-native-fidelity.md).

## Resultado que permite continuar

Unreal 5.8 cargó el sistema exacto, resolvió sus versiones y exportó sus gráficos sin
descompilar el ejecutable. El [helper](../../../tools/unreal-niagara-probe/README.md)
C++ compiló y ejecutó correctamente en la copia aislada con NullRHI. Dos ejecuciones
en procesos nuevos produjeron el mismo documento de valores. Hay una vía concreta
para obtener datos verificables; REA no fue necesario para esta extracción.

[Valores efectivos](native-values.json): dos handles y dos renderers habilitados, uno
por emisor. La llama usa `MI_Flame_2`, grilla 8×4, FaceCamera; el humo usa `MI_Smoke_1`,
grilla 10×6, FaceCameraPlane. Ambos usan CPUSim y no tienen determinismo activado en
el asset. La enumeración anterior de subobjetos incluía copias heredadas; no se suman
como capas activas y `MI_Flame_1` no se convierte en un tercer renderer.

Se leyeron 100 registros de rapid iteration en ocho stores: 80 nombres únicos, 41 de
llama y 39 de humo. [Auditoría independiente](native-values-audit.json): los 100 valores
se recomputaron desde sus bytes y coincidieron por nombre/offset/buffer con los scripts
seleccionados en el T3D. Los índices de tipo son locales al proceso; la decodificación
usa el tipo real y su tamaño, incluidos bool estático y quaternion. Cero registros
opacos en esta muestra. Los nombres repetidos entre usos no son controles nuevos.

[Cadenas de módulos](active-stack-audit.json): los ocho usos tienen un recorrido único
desde su salida por las conexiones del mapa de parámetros hasta su entrada, ligado
al `graphSourceObjectPath` efectivo. Se conservan usos interpolados y flags de módulos
desactivados. Los candidatos conectados sin desactivación explícita son 7 en llama
y 9 en humo; esto es una prueba de enlaces y flags, no de ejecución o semántica compilada.
Los Dynamic Inputs, nodos desconectados y gráficos de padres no se cuentan como módulos
activos. Por ejemplo, conservar un valor de SpawnBurst no prueba que ese módulo se ejecute.

Las tres instancias inspeccionadas comparten `M_Smoke`, un padre translúcido/unlit con
seis expresiones. El gráfico conecta RGB de textura/color por partícula a emisión y
textura/alfa de partícula mediante clamp y DepthFade a opacidad. [Defaults observados](material-defaults.json):
clamp 0–1, DepthFade 100 cm, sampler de color y mezcla SubUV activada en el material;
los renderers tienen `bSubImageBlend=false`. `T_FireBall` es el default del padre;
las instancias sustituyen `SUBUV` por sus texturas. No se deduce una capa adicional.
La coerción a opacidad escalar y la interacción material/renderer requieren revisión
de semántica; no están traducidas a un shader Three.js por esta entrega.

## Evidencia y reproducibilidad

[Checkpoint](checkpoint.json), [exportaciones](source-export-manifest.json),
[fuentes/copias](source-copy-audit.json), [parser](parser-checks.json).
Los 51 archivos originales y sus 51 copias conservaron sus SHA después de todas las
consultas. El sistema tiene SHA `985a431dc6c0d1ca1c43a31765754bae7cc78b853ca1fcadc1fa3fd093ec2165`.
No se usó el asset del mismo nombre de SimpleMultiplayerSurvival ni el `T_FireBall`
de ArrowTrail. Los originales en `C:\Unreal` permanecen intactos.

El exportador T3D obtuvo el sistema, dos emisores, tres instancias y su material padre.
El parser procesó el sistema de 11,37 MB: 451 registros de objetos, 385 pins y nueve
literales de curva. Son registros sintácticos, incluidas declaraciones/definiciones
y herencia; no equivalen a 451 objetos activos ni nueve curvas usadas. Conserva bytes
opacos y no usa `eval`. Límites: 32 MiB por archivo, 4 MiB por línea, profundidad 64 y
10.000 registros. Se comprobaron campos con comas/paréntesis entre comillas, bytes
anidados y cuatro rechazos de sintaxis/tamaño. El cambio final de marcado opaco dejó
idénticos los objetos/pins usados por la auditoría de cadenas.

Las fuentes del helper y probes están versionadas. Los `.uasset`, T3D completos,
binarios compilados, cachés y logs quedan en `.scratch/unreal`, fuera del bundle.
Python no expone aquí los handles/graphs/rapid iteration; sus errores se conservan
en la evidencia. El helper C++ cubre esa parte. La compilación funcionó con MSVC 14.51
y SDK de Windows, aunque Unreal advierte que ese compilador es posterior al preferido
y aparecen avisos de APIs del engine. Las consultas finales terminaron sin errores
ni warnings de ejecución. No se repitió la suite general del juego: no cambió runtime.

Los scripts Python entregados se volvieron a ejecutar desde una segunda copia fresca,
con sus fuentes exactas. Sus T3D cambiaron IDs de cambio/caché al cargar: se verificó
igualdad de todo el resto del texto de los siete archivos, excluyendo únicamente líneas
completas `CachedChangeId`, `ChangeId` y `LastBuiltTraversalDataChangeId` de 32 hex.
No se excluyeron parámetros, versiones, nodos, pins ni conexiones. Los hashes crudos
anteriores/finales se conservan en el checkpoint; no se promete identidad binaria del T3D.

## Decisión y límites del siguiente corte

**Seguir con un prototipo privado de este sistema.** Dos emisores CPU, un material
común y datos trazables justifican ese experimento acotado. No se extrapola su coste
a las 916 identidades ni se promete un calendario para la biblioteca completa.

Antes de aceptar el port: completar estado global del sistema, entradas dinámicas,
curvas/defaults/tangentes y semántica/orden de módulos; preparar una referencia Unreal
multiángulo con reloj, semillas y exposición controlados. Después implementar las
partículas independientes y el material, comparar silueta/color/movimiento/capas y
medir coste. Un estudio de móvil físico se separa de la emulación.

Reconsiderar el alcance si este piloto exige reproducir grandes interfaces, fluidos,
una parte desproporcionada del renderer o si el resultado no se acerca a la referencia
con el presupuesto del juego. No sustituirlo silenciosamente por un efecto genérico.
El objetivo aprobado es conservar calidad; la evidencia de extracción no demuestra
todavía calidad AAA, equivalencia temporal, densidad editable o viabilidad de todos
los sistemas. No hay nuevo efecto habilitado, migración, protocolo o acción de gameplay.
