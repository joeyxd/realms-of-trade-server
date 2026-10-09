# L03c — metas revisables con feedback

`AgentMind.reviseGoals()` propone una nueva revisión del archivo real `objectives.json`.
Comparte la única consulta en curso y el `InferenceBudget` de `decide()` y `converse()`.
El cuerpo sigue enviando inputs mientras espera la inferencia. La revisión de metas no envía una
orden corporal: una decisión posterior consume el archivo vigente y se valida por el contrato normal.

## API y salida

```js
const store = createObjectiveStore({ directory, scope });
let files;
const mind = new AgentMind({
  adapter, budget,
  readSnapshot: async () => {
    files = await loadOwnerFiles({ directory, scope });
    return runnerMindSnapshot(runner, files);
  },
  readCommitSnapshot: () => runnerMindSnapshot(runner, files),
  commitGoals: store.commit,
  submitOrder: order => runner.order(order),
});
await mind.reviseGoals();
```

Sin `commitGoals` la operación devuelve `goals_disabled`. Al habilitarla se exige también
`readCommitSnapshot`, una lectura síncrona del control vigente. Ambos callbacks son componentes
confiables del runner; nunca se entregan al modelo. El writer llama al guard síncrono, puro e
idempotente antes de comprobar los archivos y otra vez inmediatamente antes del rename.

La salida del modelo acepta exclusivamente `wait` o:

```json
{"v":1,"decision":{"type":"revise_goals","args":{"goals":[{"id":"stay-safe","status":"active","text":"Mantener distancia y conservar salud.","constraints":["Solo capacidades autorizadas"]}],"reason":"La observación muestra salud baja.","basis":["observation:12"]}}}
```

El runner fija scope, revisión siguiente, hashes y ruta. Hay un máximo de 32 metas únicas,
con los campos existentes de v1: ID de hasta 128 caracteres, texto de hasta 2000 y hasta
32 restricciones de 500. Razón de hasta 1000 y de una a ocho referencias de feedback presentes
en el contexto fijado. Se rechazan campos extra, controles, texto sin normalizar y credenciales
reconocibles. Un archivo existente con más de 32 metas devuelve `goal_capacity` antes de inferencia;
no se reduce silenciosamente para ajustarse a este corte.

La mente puede elegir `active`, `paused` o `blocked`, y conservar metas `completed` existentes
exactamente iguales. Este corte no deduce cumplimiento semántico: ACK, swing, efectos parciales
o desaparición de un objetivo no permiten crear una meta completada. El texto y las restricciones
son datos de planificación; no amplían capacidades, autoridad ni presupuesto y no constituyen
un mecanismo adicional de enforcement del gameplay.

## Contexto y evidencia

El contexto conserva los seis bloques L00. `required.tools.goalRevision` fija la revisión anterior,
metas, observación propia confirmada y una ventana de las últimas 16 acciones con hasta cuatro
efectos por acción. Distingue estado, ACK, efectos parciales y resultado correlacionado. La observación
fijada es histórica, con revisión/tick; no se presenta como estado actualizado al momento de escribir.
Los resultados pendientes e inciertos completos siguen protegidos en `required.pending` aunque
su acción salga de esa ventana. No se incorpora el historial completo ni se llama a un modelo
adicional para compactarlo. Si el contexto mínimo no cabe, la consulta se rechaza antes de I/O.

`providerContext` permite inspeccionar el documento seleccionado enviado al adaptador, incluyendo
personalidad, metas y feedback. El reporte mide y fingerprinta el cuerpo completo que prepara el
adaptador, con instrucciones/schema y reservas. El adaptador debe contar su payload real y aportar
uso nativo; un proveedor real, tokenizer, tarifas y facturación mantienen su evidencia pendiente.

Un resultado de revisión contiene recibo del archivo, razón, referencias completas seleccionadas
y hash del feedback. `assessment: model_proposal` y `gameplaySuccess: false` distinguen una meta
elegida de una acción conseguida. Esa procedencia es inspeccionable en el proceso; no es un archivo
de memoria o un journal de auditoría persistente de L04.

## Escritura, prioridad y cancelación

`createObjectiveStore` requiere un directorio absoluto explícito, scope exacto y archivos normales
válidos. Captura entradas separadas de sus referencias originales. Solo escribe `objectives.json`;
personalidad y memoria permanecen intactas. Usa lock exclusivo cooperativo `.objectives.lock`,
temporal exclusivo en el mismo directorio, checks de identidad/hashes/revisión y rename atómico.
No rompe locks antiguos automáticamente. Un lock abandonado exige inspección del dueño.

Después de preparar el temporal, comprueba de forma síncrona los tres archivos y los bytes del
temporal, con límites de lectura. Revalida vida, permisos, scope/sesión/epoch, frescura, prioridad
directa del dueño y tarea antes de escribir. No hay `await` entre la comprobación final y el rename.
Ediciones observadas del dueño o una orden/stop recibido durante la espera invalidan la propuesta.

El lock coordina writers que respetan este contrato local. Un editor externo que no lo use aún
puede cambiar archivos entre comparación y rename: esto no es CAS del sistema operativo ni una
garantía multi-host. No se certifica durabilidad ante caída del sistema o fsync del directorio.
Las lecturas/hashes finales de hasta aproximadamente 1.3 MiB son síncronas y pueden ocupar
brevemente el event loop del runner; la continuidad durante inferencia no prueba latencia física.

Timeout/cancelación invalidan la inferencia. Si el callback de escritura ya está en curso, su resultado
se mantiene incierto y bloquea revisiones adicionales hasta recibir un resultado conocido. Un recibo
tardío válido aparece en `state.records[].lateObjective`, con `committed` o `rejected` y
`afterInterruption: true`. Cancelar no deshace una escritura que terminó antes. Un fallo o recibo
ambiguo deja `objective_commit_uncertain` y `retryAllowed: false`; no se repite automáticamente.
El uso de inferencia se reconcilia aunque el resultado llegue después de stop.

## CLI de ensayo

```text
node tools/agent/run.mjs --url ws://127.0.0.1:5173/ws --files C:/ruta/agente --owner owner-lab --character brisa-lab --world world-lab --mind simulated --mind-goals
{"type":"revise_goals"}
{"type":"files"}
{"type":"think"}
{"type":"mind"}
```

La CLI usa una política escrita de ensayo que cambia la meta según salud confirmada. No demuestra
calidad táctica ni lingüística de un LLM. `think` conserva su decisión simulada configurada
(por defecto `wait`); el ensayo PvE inyecta un adaptador que elige órdenes desde las metas frescas.
No hay revisión automática por tick, reintentos pagados, proveedor elegido, nuevas capacidades ni
panel del dueño. `files` muestra el contenido vigente y su revisión. Stop/exit siguen respondiendo
mientras la inferencia espera.

[Entrega y evidencia](../delivery/l03c-agent-goals.md). [L04a](memory-runner.md) añade persistencia y recuperación
de memoria con fuentes/vigencia; sigue L04b. Proveedor real y experiencia humana PvE siguen pendientes.
