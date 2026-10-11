# D09f-2b.2 — efecto swallow confirmado en tick

Dueño M5: `server/pearlStaging.mjs`, efecto ECS server-only, pruebas y evidencia aisladas.
Gameplay D08 conserva sim/LocalServer/host/cliente/protocolo/entrypoints; este corte no los modifica.
Requiere el [CAS same-holder 006](m5-pearl-same-holder.md), sin nueva migración ni env.

## Contrato

`PearlStaging.swallow({ uid, source: { clientId, entity }, expectedVersion })` admite solo un UID
gestionado en bag y swallowed vacío. Cuenta/kind provienen de la autoridad; UUID se genera una vez.
`replaceUid` y swallowed ocupado se rechazan; death/reemplazo requieren un lote real pendiente.

Ejecutar el helper real `swallowPearl` con perfil/ECS separados antes de reservar/esperar. Su calma,
vida, ataques/cast/dash y enemigos cercanos determinan admisión. No cambiar perfil, stats, ledger,
dirty, eventos, drops, RNG ni contadores vivos. Un permiso común reserva la cuenta/UID hasta apply/fence.
La cola ground drena saves previos, congela CAS/request y confirma recibo/diario fuera del tick.

Solo `drain()` síncrono aplica. Verificar identidades, vida, ledger, slots, versión y lanes actuales;
rebasar pearls sobre progreso vivo. Calma es elegibilidad capturada al aceptar, como en give: no repetirla
tras SQL, pues combate/movimiento pueden avanzar durante el RPC. Death/close/recycle invalidan y cercan.

Preparar el efecto en una fila ECS separada **actual**: `gBuf=0`, `cdG=max(actual, PEARL.swapCd)`,
`waterT=0` y `refreshStats` real con el perfil actualizado. Preservar fracción HP, reglas de stamina,
gear/mastery/loadout actuales y todas las columnas que el efecto no escribe. La copia preflight no se aplica.
Decorar el único `pearlChanged(op=swallow)` contra el elem posterior; publicar después de apply/save enqueue.
Si falla, revertir solo los cambios locales tentativos y retener fence; no revertir SQL ni aplicar al reconciliar.

## Reutilización verificada

Inventario `actionrpg/FINDINGS.md`: `BP_InventoryComponent` (`EquipItemBySlot`, `DeepFindItemByUID`),
`ServerSlotInfoArray`, `Skills/S_PlayerStats` y `BP_JigServerSave` son referencias empaquetadas sin
lógica Node/CAS portable. Se reutilizan el helper real, `refreshStats`, tuning `PEARL`, staging, gate,
cola y diario actuales. Sin exportaciones, assets nuevos ni cambios a fuentes Unreal.

Al aceptar D09f-2b.2 los tres resets de `changed()` se reproducían en el adaptador server-only y
se comparaban con el helper real para los cuatro kinds. [D09f-2b.3](../delivery/d09f-common-effect.md)
extrae esa regla común con sim antes de cambiar sus reglas, manteniendo un escritor por archivo.

## Aceptación y siguiente paso

Memoria y SDK/SQL006: RPC/diario lentos, saves previos/posteriores, HP/gear/cooldowns cambiantes,
los cuatro poderes, respuesta perdida/replay, close/death→revival/recycle/bypass, fallo de publicación,
enqueue/release y rollback ECS completo. Autoridad SQL nueva carga estado actual sin evento histórico.
Regresión aislada y hashes; no sustituye restart real de GameHost, pruebas multi-host ni recorrido visual.

Después: contrato SQL/DTO/diario de lote para death/reemplazo; [hooks completos](m5-pearl-common-gate.md)
con dueño gameplay; efecto compartido extraído en D09f-2b.3. Hidratación/scope/reloj/adopción/invitados
antes de activación. [006 aceptada real posteriormente](../delivery/d09f-same-holder-live.md): 21/21.
P4/P6 parciales; no activar solo give/swallow.
