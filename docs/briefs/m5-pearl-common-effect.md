# D09f-2b.3 — regla compartida del cambio de perla

2026-10-06. Base `60a4773`, después de la aceptación real de SQL 006. Corte de refactor
de sim/staging; no conecta circulación durable al host ni añade mecánicas o balance.
El principal asume la integración de sim de este corte; Luna implementa tres archivos
delimitados y revisa reutilización/regresión. Un escritor por archivo.

## Problema y contrato

`changed()` en `src/sim/systems/pearls.js` y `pearlSwallowEffect()` en
`server/pearlEcsEffect.mjs` duplicaban el reset de entrada G, el enfriamiento mínimo,
el reset del reloj de maldición acuática y el recálculo de stats. Un cambio futuro
podía actualizar un camino y dejar el otro con reglas distintas.

`applyPearlChange(world, entity)` en `src/sim/systems/pearlEffect.js` contiene esa regla:

- Aplicación síncrona sobre la fila ECS y el perfil presentes en la vista recibida.
- `gBuf=0`, `cdG=max(actual, PEARL.swapCd)`, `waterT=0` y `refreshStats` existente.
- No cambia slots del perfil, propiedad, drops, RNG, dirty, eventos ni reservas.
- No decide elegibilidad, repite calma, espera storage ni publica un éxito.

La sim llama al helper desde `changed()` y conserva mark/evento después del efecto,
en el orden actual de swallow, spit y spill. Esto conserva su comportamiento existente;
no añade staging durable de reemplazo o muerte.

El adaptador server-only llama al mismo helper sobre su fila numérica separada y una
copia del perfil actualizado. Sigue preparando desde ECS/progreso actuales en `drain()`,
sin aplicar la copia antigua de preflight. Conserva verificación de identidad de columnas,
apply y rollback locales, reserva hasta apply/fence y publicación posterior al commit.

## Cruce Unreal/FAB

Revisión acotada del [informe ActionRPG](../research/unreal-assets/actionrpg/FINDINGS.md):
`BP_InventoryComponent`, `ServerSlotInfoArray`, `Skills/S_PlayerStats` y `BP_JigServerSave`
son referencias empaquetadas de inventario/stats/guardado, sin código JS ejecutable ni
una regla equivalente portable de cambio de perla. Reutilizar el helper y stats propios
evita duplicación. Sin nuevo inventario, exportación, arte ni modificación de `C:\Unreal`.

## Aceptación

Usar las pruebas de comportamiento existentes, sin crear tests que reproduzcan la
implementación de cuatro líneas:

- `pearls` / `pearlkit`: swallow, reemplazo confirmado, spit, muerte, cuatro poderes,
  maldiciones, circulación y predicción.
- Staging memoria/SDK-SQL: cuatro kinds, RPC/diario lentos y replay exacto; HP fraccional,
  gear/mastery/progreso y cooldowns actuales; ningún cambio vivo antes del tick.
- Fences por close/death/recycle/bypass y rollback local completo si falla publicación,
  enqueue o release. Otro jugador y el commit durable permanecen intactos.
- Regresión completa sobre fuente fijada, hashes y revisión independiente del diff.

No se requiere QA visual para este refactor sin cambios de render/UI. No equivale a
aceptación live de GameHost, dispositivos, leases o publicación de una demo nueva.

## Después

Lote atómico multi-UID para reemplazo/muerte, [hooks completos](m5-pearl-common-gate.md)
y restauración/scope/reloj/adopción antes de activar circulación durable. Afinidad
permanente por personaje/tipo sigue como misión separada con su contrato existente.
