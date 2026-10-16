# D08c.7b — preparar materiales antes de construir

Fecha: 2026-10-08. Implementación local **0.6.0-alpha.13 / protocolo 29**.
[Contrato](../briefs/d08c7b-workbench.md). Sin commit, push, publicación ni SQL en este corte.
Protocolo conserva la autoridad de agentes L02c del checkout y añade tandas de materiales.

## Resultado

El banco existente abre un panel con la receta tronco → madera, cantidad, materiales
disponibles y espacio de mochila. Botones 1, 3, Máx. y cantidad manual; preparar solo
se habilita cuando cabe el lote y hay materiales. La madera sigue pagando las piezas
y reparaciones ya integradas de la balsa. Disponible con F y acción táctil contextual.

Servidor consume/produce toda la tanda y sube `tradeRev` una vez, sin oro ni cambios
ajenos al inventario. Cantidad forma parte de la firma del recibo; omitirla equivale a
la receta anterior de una unidad. Rechazos conservan bienes/revisión/cooldown.
Cerrar/reabrir conserva el ID pendiente, con reintento exacto después de cinco segundos.
La UI espera ack y actualización de mochila, sin conceder materiales por adelantado.
Alejarse oculta el panel/prompt; regresar permite recuperar la solicitud pendiente.

Panel con paleta madera, dorado y turquesa, cuerpo desplazable y pie de confirmación fijo.
Al abrir, aparta acciones de combate/táctiles; al cerrar recupera los controles ordinarios.
Reutiliza banco S19/atlas S14 ya presentes: cero assets/texturas nuevos. Candidatos
Unreal/GLB y decisión de reutilización registrados en el contrato; fuentes intactas.

## Verificación local

**61/61 pruebas seleccionadas**, incluidas nueve del nuevo archivo de tandas:

```powershell
node --test tests/resources.test.mjs tests/resource-loop-server.test.mjs tests/workbench-batch.test.mjs tests/net.test.mjs tests/commerce.test.mjs tests/raft-editor.test.mjs tests/raft-production-server.test.mjs tests/agent-authority-network.test.mjs
node tools/qa-workbench.mjs
```

Casos: cantidades inválidas, consumo exacto, replay/cambio de ID, falta de materiales,
capacidad, revisión obsoleta, guardado rechazado o excepción, calma/vida/distancia,
solicitudes concurrentes a la misma revisión y guardado HMAC con reentrada.
La regresión de recursos incluye consumo real en construcción; comercio/producción,
editor, red y autoridad de agentes conservan sus contratos. El harness anterior
`qa-resource-loop.mjs` se adapta para confirmar/cerrar el nuevo panel.

Navegador: **3/3 vistas emuladas** (1280×720, 844×390 y 390×844 con rotación del juego),
capturas inspeccionadas y cero errores JS/consola en la pasada aceptada.
[Evidencia](d08c7b-workbench/evidence.json) y [captura horizontal](d08c7b-workbench/mobile-844x390-01-batch-ready.png).
Recoger dos troncos + una piedra, elegir máximo, preparar dos maderas y recargar/reentrar
con carga/revisión/oro conservados. Elegir tres con solo dos troncos deshabilita la preparación.
Escritorio pierde deliberadamente el primer ack: cerrar, alejarse, regresar y reintentar
el mismo ID recupera la confirmación sin segundo débito. Controles/panel dentro del viewport.

Fixtures: hosts efímeros loopback, memoria y contexts de navegador separados; se recoloca
el ECS del jugador para alcanzar nodos/banco. Recogida, cantidades y preparación usan
controles reales; no se inyectan materiales. Three/GSAP se sirven localmente para QA.
Un primer fixture pidió tres troncos + piedra (11/10) y fue corregido a dos + piedra
(8/10) sin modificar el catálogo. La prueba unitaria de overflow altera temporalmente
el volumen de salida y lo restaura; integración y navegador usan los valores reales.
Otra pasada anticipó un frame la pose usada por UI al recolocar al jugador; el harness
espera ahora tanto predicción como `ps` antes de comprobar el prompt fuera del radio.
Las dos incidencias eran de fixtures; la aceptación corresponde al JSON final enlazado.

## Continuidad

Recibos de recursos son acotados y de sesión; nodos y cooldown no son durables.
Reentrada guest usa el guardado firmado existente y conserva su ventana periódica:
no acredita transacción durable antifraude, Supabase live ni recuperación entre hosts.
No se ha construido A1: proyecto compartido, progreso del pueblo y recetas aprendidas
requieren un commit conjunto de inventario/proyecto/recibo y después integración del artesano.

El plan de tres pueblos y corredor terrestre queda como base aprobada de trabajo.
Siguiente corte de esa línea: contrato de persistencia atómica para aportes comunitarios,
coordinando anclas/estados visuales con arte. Este banco no simula que la obra ya existe.
GPU/FPS y teléfono físico no se aceptan mediante estas vistas emuladas.
