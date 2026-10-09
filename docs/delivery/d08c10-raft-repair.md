# D08c.10 — Reparación material por piezas

Implementado localmente, 2026-10-07 (México): **0.6.0-alpha.10 / protocolo 25**.
[Contrato](../briefs/d08c10-raft-repair.md). Sin commit/push, publicación ni SQL en este corte.

Tu barco-hogar conserva ahora el daño entre viajes de una misma sesión. Al atracar, recuperarlo desde
puerto o perder soporte, el body se cierra pero su condición queda en la nave adjunta del servidor.
Volver a zarpar usa las mismas identidades y HP; el plano guardado no pierde sus casillas.

En el astillero, **Reparar** muestra las piezas dañadas, sus HP, casilla y materiales. Seleccionar una
abre la confirmación; sólo su botón envía la intención. El servidor valida dueño, quietud, ubicación,
revisión, índice/tupla, identidad y HP esperado. Precio y vida final se calculan en autoridad.
Primero debita bodega, después mochila. Estado, materiales y revisión se confirman juntos tras preflight
de guardado, ubicación y ocupantes. Reintentar la misma operación devuelve su recibo sin otro cobro.

| Condición | Reparación | Retiro |
|---|---|---|
| Cimiento 60/60 HP | Rechaza: sano | 2 madera |
| Cimiento 30/60 HP | 2 madera → 60/60 HP | 1 madera |
| Cimiento 0/60 HP | 4 madera → misma instancia 60/60 HP | 0 materiales |
| Cimiento reforzado 45/90 HP | 3 madera + 1 hierro → 90/90 HP | 1 madera |

Por material, reparar cuesta `ceil(coste de construir × fracción de HP faltante)`; daño positivo
siempre requiere al menos una unidad de cada material del tipo. Retirar devuelve
`floor(coste × 0.5 × fracción sana)`. Reforzar conserva la fracción de vida: 30/60 pasa a 45/90,
sin sanar el resto de la nave. Reconstruir una pieza destruida nunca inserta otra ni duplica bienes.
Cifras iniciales; no constituyen balance humano aceptado.

Representación y geometría usan piezas vivas; la selección del editor mantiene los índices del plano
completo. La pasarela del plano permite acceder desde el muelle incluso después de perder toda
flotación. Carga y compras utilizan el porte real. Bodega legacy conserva mercancía/volumen nominal,
permite retirada y rechaza depósitos que aumentan exceso. Redes/parrillas destruidas no producen ni
aparecen activas en sus filas; conservan trabajo previo y reanudan sin acumular tiempo ausentes.

Reutilización Unreal/FAB: `SM_RepairBench` de Dreamrise es candidato físico sin GLB/dependencias
aceptadas; no aporta ahorro inmediato a la operación del editor. `BP_Holdable_BuildHammer` sirve como
referencia de interacción y `SM_Hammer` sigue sin exportar/inspeccionar. Se reutilizan astillero,
glifos, modelos y atlas existentes. Fuentes `C:\Unreal` intactas, cero imágenes o texturas nuevas.

Validación: **355/355 pruebas pertinentes**, incluidas **11 nuevas** de reparación, conservación,
autoridad, valores no finitos, rollback/replay, refuerzo, reconstrucción, pérdida total de flotación,
carga y producción. [Log final](d08c10-raft-repair/regression-final.log).

**3/3 vistas emuladas**: escritorio 1280×720, móvil 844×390 y vertical 390×844 con stage rotado.
[JSON](d08c10-raft-repair/raft-repair-evidence.json) y
[runner](../../tools/qa-raft-repair.mjs). En cada vista: montaje por interacción real,
daño de fixture por `queueDamage` + tick admitido, atraque con casco 210/240 HP, elección/confirmación
en UI, ACK exacto de 2 madera, casco 240/240, inventarios y revisión +1, misma pieza/tupla/plano,
y remontaje con HP reparados. Pase final: cero errores JS/consola/solicitudes/HTTP.
Capturas finales inspeccionadas por worker y root: selección/coste/botón móvil y casco tras remontar.
El primer intento falló por un lookup del runner del ancla del timón; diagnóstico preservado y corregido.

El harness usa un host temporal con memoria, fixtures de materiales/posición/encuadre/daño y rutas
locales de dependencias. No prueba cuentas/WAN, impacto de costa real en navegador, teléfono físico,
FPS, audición ni balance humano. Los tests sí mantienen la cobertura de impacto costero autoritativo.

Límite importante: **HP y pose siguen siendo de sesión**. Al desconectar/reiniciar, la condición
se inicializa desde el plano intacto; materiales y revisión sí siguen el guardado existente. Esta base
no admite todavía riesgo económico público o pérdidas definitivas. El siguiente corte debe conservar
condición/pose con valores legacy y recuperación coherente antes de la primera amenaza de ruta.

Artefacto local: `d08c10-raft-repair/artifact.html`, generado desde el checkout compartido actual,
incluido trabajo visual/chat/agentes concurrente. Metadatos y SHA-256 en `artifact-meta.json`.
El paquete no es una publicación ni una prueba de cambios ajenos a esta misión.
