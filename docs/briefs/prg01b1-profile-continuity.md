# PRG01b1 — perfil compatible para el aprendizaje

2026-10-10. Primer tramo de PRG01b: compatibilidad y conservación del perfil. La actividad de Tala,
el reparto cooperativo y su beneficio de cadencia todavía no están montados.

## Contrato que queda implementado

El perfil exterior conserva `v:1`. Los personajes nuevos incluyen este bloque independiente de XP,
maestría de armas, tatuajes, perlas, materiales e idioma:

```json
{"v":1,"practice":{"logging":0},"milestones":[],"knowledge":[]}
```

`progression.v` versiona el aprendizaje. Se reutilizan el catálogo y cálculo puro de Tala: presupuesto
10 por palmera concluida, primer hito 60, intervalo previsto 54→45 ticks y conocimiento `raft_storage`
separado de la elegibilidad. Ninguno de esos valores se concede por añadir el campo al perfil.

El saneado distingue ausencia histórica de corrupción:

| Entrada | Resultado |
|---|---|
| Perfil anterior sin `progression` propio | Conserva la ausencia física; `readProgression(undefined)` representa cero |
| Bloque presente válido | Copia nueva, mismos puntos/hitos/conocimientos |
| Bloque presente incompleto, desconocido, fuera de rango o de otra versión | Rechaza el perfil completo; no lo reinicia a cero |
| Propiedad heredada, getter, no enumerable o valor `undefined` explícito | Rechaza sin ejecutar el getter |

El default histórico es **diferido**. Añadirlo durante cada lectura cambiaría los DTO de recibos
inmutables y rompería sus comparaciones exactas. La operación que conceda práctica materializará el
bloque en el candidato de perfil, dentro de su transacción, conservando el baseline y recibos anteriores.
No se hace backfill SQL, no se rescriben recibos y no se toca la versión CAS por una lectura.

`newProfile`, `sanitizeProfile`, firma/carga de saves, attach/sync/detach y las sesiones M5 conservan
el bloque válido. La muerte conserva práctica y conocimientos: sus pérdidas existentes no se amplían.
Un perfil persistido corrupto bloquea la admisión y permanece intacto para diagnóstico.

## Dueño, scope, confirmación y recuperación

- **Dueño:** perfil de la cuenta administrado por `ProfileSessions`/store M5. No aparece otro escritor.
- **Scope actual:** la misma cuenta del host; el aislamiento personaje/mundo/época sigue pendiente de AREA15.
- **Migración:** campo JSON opcional, default diferido y versión interior 1; no requiere SQL nuevo para conservarlo.
- **Confirmación:** este corte solo conserva valores a través de guardados/operaciones existentes. No añade un
  ACK de práctica ni cambia las ventanas de autosave de XP/equipo u otras acciones.
- **Recuperación:** reentrada carga la fila actual. Replay económico histórico devuelve su recibo original y
  no instala su perfil viejo, ni duplica bienes, ni reduce práctica. Datos de versión futura fallan cerrados.

Los protocolos 34 del checkout compartido y 32 de la rama publicada se revisaron y se conservan:
`PROFILE.p` es un objeto JSON completo; el campo es opcional,
sin cambios de comandos, snapshots, `you`, tuplas o predicción. Antes de montar el beneficio/eventos nuevos,
PRG01b2 debe volver a revisar el contrato de red. Una versión antigua del runtime que desconozca aprendizaje
no será un rollback válido una vez que haya práctica real guardada.

Los límites existentes siguen siendo 32 KiB para blobs de invitado y 128 KiB para perfiles M5. La operación
futura debe comprobar el candidato completo de cada beneficiario, no solo el tamaño del bloque añadido.

## Integración siguiente: PRG01b2

Se reutiliza la autoridad económica y el trabajo de recursos SQL015 de AREA15. Ese frente está avanzando
en paralelo en este checkout; este corte no modifica sus archivos, migración ni activación.

1. Confirmar la versión final de recursos y su reloj lógico pausado offline. SQL015 incorpora golpes
   parciales durables: el registro de contribuyentes deberá conservarse con esos golpes en la misma
   transacción. Esto sustituye la propuesta anterior de descartar golpes parciales al reiniciar.
2. Definir/adoptar ciclo y contribuyentes de cada palmera. No inventar autores para golpes legacy sin
   registro ni reiniciar silenciosamente revisiones/nodos; cerrar su migración antes de activar práctica.
3. Extender la misma operación M5 a una lista ordenada de perfiles, con reservas/CAS de participantes
   conectados y filas actuales de participantes offline. Nodo, material, práctica, hitos y recibo se
   confirman juntos. SQL014/015 siguen siendo de un solo perfil; no bastan para el reparto cooperativo.
4. Reutilizar `planLoggingHit`: tres golpes, dos troncos para quien concluye, diez puntos proporcionales
   entre contribuyentes, sin XP general o de combate. Aplicar intervalo anterior al golpe que abre el hito.
5. Ficha mínima en Habilidades ES/EN y contador de acción derivado del intervalo confirmado por el servidor.
   Probar cooperación/desconexión/reentrada, pérdida de respuesta y caída antes/después del commit.

Después sigue PRG01c, artesano → enseñanza personal → bodega. El hito no enseña la receta automáticamente.

## Reutilización y comprobación

Se reutilizan perfil, saves, sesiones, recibos, muerte, palmeras/hacha/banco y renderer existentes. El cruce
Unreal de PRG01a ya identificó Blueprints como referencias y la caja aceptada para `crate`; este corte de
datos no necesita arte ni exportaciones nuevas y no modifica fuentes Unreal.

[Pruebas de perfil](../../tests/progression-profile.test.mjs),
[continuidad M5](../../tests/progression-continuity.test.mjs) y
[cálculo puro](../../tests/progression-logging.test.mjs). El hito sembrado en fixtures es un dato de prueba,
no evidencia de práctica concedida al talar. [Entrega y evidencia](../delivery/prg01b1-profile-continuity.md).
