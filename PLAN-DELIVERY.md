# Plan de ejecución — juego, assets y equipo de agentes

Fecha: 2026-10-04. Este es el **orden operativo** para avanzar paso a paso desde el juego actual hacia
casas/barcos habitables, comercio, combate naval y ciudades productivas. Integra mecánicas y pruebas de assets;
no es otra lista de ideas ni anuncia que las entregas estén hechas.

## 1. Punto de partida y documentos que mandan

- Fotografía al redactar este plan: base de mecánicas commiteada Escarcha, `40949b2`, `0.4.8-alpha.2`, protocolo 9;
  Brasa y circulación también hechas. HEAD `20d8ee6` incorpora dirección naval.
- Tormenta tiene cambios y evidencia de pruebas locales en el checkout, aún sin commit al redactar este plan.
  Esta entrega documental no los revalida ni acepta. Al retomar, comprobar HEAD/HANDOFF y actualizar D01/D02;
  si Tormenta ya está aceptada, pasar a Tinta. No pisar ni reasignar archivos activos sin identificar al dueño.
- Checkpoint posterior D01: Tormenta integrada en `66e6e67`, `0.4.8-alpha.3`, protocolo 10. Mecánica y recorrido
  visual en escritorio/móvil emulado aceptados; GPU, teléfono/mando reales y publicación pendientes.
  Evidencia: [informe D01](docs/delivery/d01-tormenta.md). Al preparar A01, D02 Tinta se implementaba en paralelo
  en el checkout compartido; su aceptación se registra debajo. A01 probado en aislamiento y aplazado para humo de
  fogatas: [resultado](docs/delivery/a01-noise00.md); código/PNG experimentales no incorporados al runtime principal.
- Checkpoint posterior D02: Tinta integrada, `0.4.8-alpha.4`, protocolo 11; marca/nube/IA y reloj autoritativo.
  Regresión 271/271 y capturas inspeccionadas en escritorio/móvil emulado. GPU y dispositivos reales pendientes.
  Evidencia: [informe D02](docs/delivery/d02-tinta.md). Próxima entrega: D03 / P5 cierre; M5 conserva su plan.
- Inventario Unreal terminado: tres proyectos, 7.406 archivos contando copias; **ningún candidato importado**
  al crear este plan. `assets/manifest.json` está vacío. No reiniciar la investigación desde cero.
- [HANDOFF](docs/HANDOFF.md): checkpoint real, pruebas y siguiente tarea. [DESIGN](DESIGN.md): diseño general.
- [Hoja naval](docs/NAVAL-ROADMAP.md): dirección acordada y decisiones pendientes. Este plan organiza su
  entrega; no convierte automáticamente recomendaciones de topología, pérdidas o abordaje en acuerdos.
- [Inventario y prioridades](docs/research/unreal-assets/SUMMARY.md),
  [candidatos](docs/research/unreal-assets/CANDIDATES.csv), [portabilidad](docs/research/unreal-assets/PORTABILITY.md)
  y [contrato de assets](docs/ASSETS.md): evidencia técnica, distinta de exportación/integración comprobada.
- Los `PLAN-M*.md` conservan sus pasos/contratos por milestone. Los IDs Dxx de aquí son paquetes de trabajo,
  no nuevas versiones del juego ni renumeración de milestones.

## 2. Regla de entrega

Cada paquete cierra **una mejora jugable y su evidencia**. Puede tener una prueba de arte paralela, pero no se
bloquea todo el milestone por un modelo que no exporta o un efecto que no mejora lo procedural.
Primero probar un recurso pequeño; adoptarlo solo cuando su coste/estilo/legibilidad encaje. Mantener fallback.
Avanzar en M4.8 mientras se preparan assets de forma aislada; después alternar construcción/economía y arte
que mejore la parte que ya se puede jugar. Nunca hacer un reemplazo completo de la isla de una sola vez.

Estados: **pendiente → preparado → en curso → en revisión → integrado → aceptado**; `aplazado` registra un
experimento que no conviene ahora. `publicado` requiere evidencia adicional de servidor/URL real y no sustituye
aceptación. Una integración con rendimiento/dispositivos pendientes debe nombrar esa limitación.

## 3. Entregas y dependencias

Todas salvo D00 son trabajo futuro o en curso al redactar; actualizar estado y evidencias al cerrar cada una.

| ID | Mecánica o resultado | Prueba/mejora de assets asociada | Depende de / aceptación principal | Estado actual |
|---|---|---|---|---|
| D00 | Inventario y dirección naval | A00: catálogo, miniaturas y candidatos | CSV/JSON reconciliados, límites de evidencia registrados | Hecho |
| D01 | M4.8 P3: Tormenta | A01 fase A: preparar Noise00 fuera del runtime activo | Cadena/carga/maldición coherentes cliente-servidor, pruebas y recorrido visual | Integrado `66e6e67`; 259/259, visual emulado aceptado; dispositivos/publicación pendientes, A01 sin integrar |
| D02 | M4.8 P4: Tinta | Humo/tinta procedural; recursos nuevos se comparan por separado | D01 integrado; marca/nube/IA y maldición día-noche probadas | Integrado alpha.4; 271/271, visual emulado aceptado; dispositivos/publicación pendientes ([informe](docs/delivery/d02-tinta.md)) |
| D03 | M4.8 P5: cierre integrado | A01 fase B terminada/aplazada para fogatas; A03 opcional tras probar recurso | D01–D02; kit/indicadores legibles, fallback y regresión. Arte nuevo puede aplazarse | Cierre pendiente; A01 no lo bloquea |
| D04 | M6 P1–P2: balsa visible y cubierta transitable | A02 caja: probar primero el hook `crate` que ya existe en la isla; preparar banco | D03; playa → cubierta, paredes/escalera, snapshots. Un mesh no crea almacenamiento | Pendiente |
| D05 | M6 P3: editor de construcción | A05: primera pieza modular compatible; procedural si falta kit | D04; fantasma/motivo/rotación/colocar/quitar con servidor como autoridad | Pendiente |
| D06 | M6 P4 + M7 P1–P3: vivir y comerciar | A02 banco en un taller/renderer ya disponible; A06 uno o dos iconos | D05; bodega/producción, mercader/quote/compra/venta y reserva local en prototipo | Pendiente |
| D07 | M5 P1–P3: almacenamiento/cuentas/mundo | Medir carga total de los pocos assets aceptados | Contratos del principal; memoria y persistencia distinguidas. Puede comenzar junto a D04–D06 | Pendiente |
| D08 | M6 manejo: materiales, navegación, distribución y carga | Piezas de A05 y feedback visual de sobrecarga | D05; una familia/tier inicial, comparar vacío/cargado/giro, datos explicables | Pendiente |
| D09 | M5 P6: movimientos/recuperación sin duplicados | Arte de daño como visual; plano y estado operativo separados | D07 y contratos de D04–D08; depósito/retirada/jettison/reintentos/recuperación conservan bienes | Pendiente |
| D10 | M6 P5–P6 inicial + M7 rutas: primer viaje/naval PvE | A07: un impacto de madera/agua; A04 un sonido si puente listo | D06,D08; D09 para riesgo persistente. Dos rutas, NPC vencible, reparar/recuperar | Pendiente |
| D11 | Dos jugadores: huida, rendición, saqueo, notoriedad/patrulla | Señales/banderas legibles, efectos pequeños | D09–D10 y reglas legales/de pérdidas definidas; dos clientes y liquidación única | Pendiente |
| D12 | Abordaje inicial, formato por definir | A05 cobertura/pasarela; reutilizar personajes actuales | D11 y formato decidido; solo/cooperativo, colisiones y latencia. Recomendación: cubiertas enganchadas | Pendiente |
| D13 | M7 P7/P10 + M8 talleres: red regional inicial; afinidad como tarea separada | A06 iconos/productos; recursos/props seleccionados; sonido puntual | D06,D07,D09; pocas cadenas de harvesting/crafting/comercio y aprendizaje validado | Pendiente |
| D14 | M8 vivienda terrestre modular + pedido/obra/caravana | A05 kit terrestre; A02 props; hut completa solo como prefab donde encaje | Editor D05, remesas D09 y oficios D13; una obra visible y una remesa escoltable/asaltable | Pendiente |
| D15 | Más tiers, clima, tecnologías, flotas y aire posterior | A08 clima; A09 personaje/rig solo con caso útil | Evidencia D10–D14; alcance por módulo/presupuesto. Aire no entra en la primera versión | Futuro |

D04–D06 y D13–D14 pueden subdividirse en misiones de un renderer, un comando o un panel; no asignar una fila
entera grande a un único agente. M5 comienza en paralelo cuando haya contratos estables; D09 es puerta
obligatoria antes de publicar bienes persistentes en riesgo. Viaje abstracto sirve para prototipo/comercio,
pero no sustituye el combate vencible que espera el jugador.

Afinidad no se añade silenciosamente al cierre de M4.8: definir mejoras/llave/XP y migración antes de su misión.
Navegación y nivel propio de barco, legalidad, pérdidas/rescate y topología se concretan al preparar sus fases;
las decisiones abiertas no bloquean texturas, el kit actual o la cubierta/editor básicos.

## 4. Cola de assets: progresión comprobable

**Candidato → preparado → conversión verificada (si aplica) → importador revisado → integrado en un consumidor
→ revisado visualmente → aceptado/aplazado → publicado cuando corresponda.** Un PNG suelto no requiere
exportación Unreal. Una miniatura, un `--dry` exitoso o un manifiesto correcto no prueban integración ni rendimiento.

| ID | Candidato y primer uso | Paso concreto / límite |
|---|---|---|
| A00 | Inventario existente | Completado; conservar rutas y confianza, sin deduplicar/borrar fuentes |
| A01 | `Noise00.png` (sA, Survival), ruido de un VFX actual | Aplazado para humo de fogatas: comparación día/noche high y low móvil sin mejora clara frente a procedural por 287 KB/~5,33 MiB. [Resultado](docs/delivery/a01-noise00.md); experimento aislado, sin entrada en manifiesto principal. [Brief](docs/briefs/assets-a01-texture-canary.md) |
| A02 | `SM_StoragePart_03` y `SM_RepairBench` (Dreamrise) | [Fuente y UE 5.8/glTF Exporter localizados](docs/delivery/a02-crate-readiness.md); exportación en copia aislada pendiente. Una caja primero por `prop:storage-crate`/`crate`; banco requiere hook propio |
| A03 | SlashTrailElemental/SwordTrail/ArrowTrail | Un efecto y un recurso por prueba; Niagara se recrea, no se ejecuta en Three.js |
| A04 | `SW_Water_Slash_01` u otro sonido corto seleccionado | Audición/exportación pendientes; nuevo puente de audio y publicación. Conservar SFX sintetizado |
| A05 | Piezas para construcción/tierra/naval | No identificado kit completo en C:\Unreal; geometría procedural primero, probar medidas/pivotes/uniones al traer uno |
| A06 | Icono/mercancía/herramienta/arma | Elegir por panel/uso existente; UI/prop propio. Un icono no trae el widget UMG ni gameplay |
| A07 | Impacto de madera/metal, splash/humo | Un evento ya autoritativo y efecto con pooling; diferenciación clara entre daño a nave/personaje |
| A08 | BigNiagaraBundle clima | Después del mar legible; recrear con presupuesto de partículas, aviso y respuesta jugable |
| A09 | Humanoide o enemigo nuevo | Después de caso jugable/rig/peso revisados. Quince huesos procedurales; clips UE no se reproducen hoy |

Para los candidatos `.uasset`, comprobar exportador/versión/dependencias al iniciar la misión. No dar por
disponible una instalación compatible ni por exportable cada archivo. Trabajar en copia/staging dentro del
workspace o temporal; **C:\Unreal permanece de solo lectura**, sin lanzar herramientas que le escriban caches,
configuración o assets. No ejecutar scripts/plugins de proyectos fuente como requisito del inventario.
Importar al juego solo los recursos finales seleccionados, nunca un proyecto, megapack o módulo base completo.

Los originales permanecen en su lugar. Guardar materiales/shaders/exportaciones intermedias y dependencias
de trabajo fuera del bundle final, con rutas explícitas. No añadir al manifiesto assets preparados que todavía
no tienen consumidor: el registro actual precarga sus entradas y aumentan descarga/memoria.

### Evidencia mínima por prueba

- Fuente exacta y hash; si hay conversión, herramienta/versión, configuración, dependencias y hash del resultado.
- Bytes del archivo y resolución/canales de textura; para GLB triángulos, materiales, bounds y pivote/escala.
  El importador solo reporta bytes para PNG: verificar decodificación y dimensiones aparte.
- ID del manifiesto, consumidor real, fallback, capturas antes/después en el mismo escenario/cámara y estado.
- Día/noche y calidad representativa; combate/objetivo/indicadores siguen visibles. Móvil emulado para layout,
  dispositivo real para rendimiento/controles antes de cerrar su aceptación de publicación.
- Descarga, memoria de textura decodificada y draw calls/triángulos; perfil de escena comparable y dispositivo
  identificado. El panel `?debug`/`renderer.info` aporta datos; capturas congeladas no acreditan temporización/FPS.
- Decisión del principal: aceptar, ajustar de forma acotada o aplazar; motivo, limitaciones y entrada siguiente.

Presupuestos iniciales de [ASSETS](docs/ASSETS.md): props apuntan a ≤6.000 triángulos, humanoides ≤20.000,
modelos mayores ≤40.000; preferir texturas 1024. El importador advierte >15 MiB, no lo bloquea: revisar también
coste total por escena/descarga. Estos techos no garantizan rendimiento; medir antes/después y mantener low útil.
La compresión KTX2, clips importados, Niagara y audio no tienen soporte automático por existir en el pack.

### Comandos existentes y herramientas pendientes

Desde raíz del repo, ejemplos que usan un archivo ya preparado; no exportan `.uasset` ni verifican un efecto:

```powershell
node tools/import-asset.mjs 'RUTA_PREPARADA/Noise00.png' --id=tex:a01-noise00 --dry
node tools/import-asset.mjs 'RUTA_PREPARADA/StoragePart_03.glb' --id=prop:storage-crate --props=crate --dry
node tools/import-asset.mjs 'RUTA_PREPARADA/SM_RepairBench.glb' --id=build:repair-bench --kind=model --dry
node tools/import-asset.mjs --check
```

Solo el principal importa al manifiesto compartido después de revisar el recurso. El CLI actual no escribe
`data:true` mediante `--data`: usar ese campo del manifiesto para ruido/máscaras y comprobarlo en el loader.
El importador no prepara audio; A04 requiere carga/reproducción y ajustar `tools/build-artifact.mjs`, que hoy
lista modelos/texturas pero no formatos de audio. Verificar archivos/HTTP reales en el bundle antes de publicar.
Modelos con alpha blend se recortan en el camino toon genérico; humo/fuego suave entra por VFX dedicado.

## 5. Trabajo entre agentes

Máximo disponible: **principal + tres GPT-6 Luna**, cuatro agentes en total. No lanzar una cuarta tarea worker
si ya están ocupados los tres slots. Usar Luna para implementaciones delimitadas, inspección, preparación
de recursos y QA que ahorren trabajo; el principal autoriza contratos de arquitectura/diseño, integra y acepta.

| Rol de una ola | Responsabilidad | Límite |
|---|---|---|
| Principal | Elegir una entrega, fijar contrato y writable paths, integrar datos/eventos/UI, decidir arte, revisar y commit | Dueño de manifiesto, protocolo, entrypoints y documentación compartida salvo delegación exclusiva explícita |
| Luna mecánica | Un sistema/comando/renderer delimitado y sus pruebas pertinentes | No abarcar sim+cliente+arte de varias entregas sin corte; pedir ampliación de archivos al principal |
| Luna recurso/cliente | Preparar un asset o implementar un consumidor/panel en archivos disjuntos | No editar la misma escena/manifest/shared file a la vez que otro worker |
| Luna revisión | Comprobar contratos, estado real, regresiones/evidencia y pendientes | Read-only por defecto; no aceptar cambios sin inspección del principal |

Roles se reasignan por ola; no mantener agentes ociosos ni repetir un inventario que ya existe. Si solo hay dos
trabajos útiles, usar dos workers. Si una tarea necesita todos los archivos de otra, serializar o usar worktrees
aislados y luego integrar secuencialmente. Crear worktree no justifica borrar ni resetear trabajo ajeno.

Antes de empezar, el principal registra dueño y rutas de cada tarea. En checkout compartido, **un solo escritor
por archivo**. Shared files como `src/main.js`, `src/render/scene.js`, `src/net/localServer.js`, protocolo, UI
central, `assets/manifest.json` y `tools/look.mjs` se reservan al principal o a un dueño exclusivo nombrado.
Un worktree desde HEAD no contiene cambios pendientes de otro: no probarlo como si incluyera Tormenta sin
integrar esos cambios. No stagear todo el árbol; commits selectivos por misión aceptada.

Briefs: [plantilla](docs/briefs/delivery-template.md) y [primera prueba A01](docs/briefs/assets-a01-texture-canary.md).
Cada brief fija objetivo, base, lecturas, contratos, archivos propios, entregables, validación, fallback y reporte.
Los workers reportan cambios/pruebas/rutas/limitaciones; no hacen commit, push o despliegue. El principal realiza
una aceptación consolidada por ola. Pruebas dependientes de una integración van después de ella.

Un solo recorrido de navegador/GPU a la vez para evitar capturas/mediciones contaminadas. Los workers pueden
preparar casos/pruebas en paralelo; agrupar regresión al tener la integración estable. Repetirla solo si cambios
o fallos nuevos lo justifican. Para arte reversible no crear tests que solo copien valores de implementación.

## 6. Primera ola preparada para retomar

| Slot | Tarea inmediata | Salida y restricción |
|---|---|---|
| Principal | Identificar/revisar dueño de Tormenta y fijar base de aceptación; preparar consumidor A01 | Preservar edits activos; integración de manifiesto/wiring solo tras liberar archivos |
| Luna 1 | D01 Tormenta, si sigue asignada a su dueño actual | Lógica/cliente y evidencia del brief de milestone; no crear un segundo escritor para los mismos archivos |
| Luna 2 | A01 fase A, según el brief | PNG preparado, decode/hash/dry y propuesta de hook aislado; sin tocar runtime activo ni manifiesto |
| Luna 3 | Preparar D02 Tinta o revisar D01 cuando llegue | Lectura/contratos/casos de prueba; implementación después de liberar rutas o en aislamiento comprobado |

Integrar D01 → implementar D02 → integrar A01 si mejora → cerrar D03. A02 puede prepararse después, sin frenar
M4.8 si aún falta exportador. Este documento prepara la ola; no afirma que esas tareas se hayan lanzado o acabado.
La entrega que creó el plan solo hizo documentación; los workers usados para redactar briefs no ejecutaron A01.
Si D01 ya tiene aceptación y commit cuando se retome, registrar ese checkpoint y usar Luna 1 para D02;
no repetir Tormenta. La preparación A01 puede continuar en paralelo con cualquiera de las dos.

## 7. Aceptación, recuperación del trabajo y publicación

Al cerrar una misión: diff acotado, contrato coherente, checks apropiados, recorrido visual si cambia producto,
fallback probado y evidencia. Simulación/red/economía requieren pruebas de autoridad y reintentos relevantes;
no basta un renderer bonito. El principal revisa resultado, registra aceptación y crea commit selectivo.

Al fallar un asset, mantener la versión procedural y registrar motivo; tras una corrección acotada, decidir si
merece otra prueba. No sustituir un problema de rig/coste por incorporar un runtime/engine entero.
Al faltar un dispositivo o herramienta, registrar exactamente lo verificado y mantener esa aceptación pendiente;
avanzar trabajo independiente. Sin GPU real no declarar 60 fps; sin URL comprobada no declarar despliegue.

Checklist de cierre que se registra en HANDOFF:

- ID Dxx/Axx, commit base/final, dueño y qué cambió; estado separado de pendiente/en curso/aceptado/publicado.
- Pruebas y resultados reales, capturas inspeccionadas/medición; limitaciones y riesgo que queda.
- Fuente/derivado final/hook y decisión de asset; actualizar fila de candidato solo con evidencia obtenida.
- Próxima tarea exacta, dependencias y writable paths. Si una decisión sigue abierta, vincularla a la hoja naval.
- Bundle desde lo commiteado con recursos referenciados; publicación y servidor/cliente compatibles son una
  fase separada. Continuar PR #1; un push no es una actualización del servidor ni del artefacto.

Registrar futuros resultados durables en `docs/delivery/`: un informe corto por misión, sin crear documentos
vacíos ahora. Capturas/mediciones grandes pueden vivir en `shots/` ignorado; copiar un resumen durable al informe.
Preparaciones locales `.scratch/`/staging no se stagean ni entran en el bundle; verificar su exclusión antes de
crear copias de proyecto. Actualizar este plan y HANDOFF en el mismo commit de cada checkpoint aceptado.

## 8. Estado de esta entrega de planificación

- Plan unificado y briefs preparados; integración de los nuevos assets todavía pendiente.
- Al redactar, Escarcha era la base commiteada y Tormenta trabajo ajeno/concurrente, sin aceptación aquí.
- Investigación C:\Unreal permanece de solo lectura. No se exportaron/importaron recursos al redactar el plan.
- Próximo paso operativo: primera ola §6, coordinada con el dueño del trabajo activo.
