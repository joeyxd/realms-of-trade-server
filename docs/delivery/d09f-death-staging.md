# D09f-2b.23 — staging y apply de muerte completa

La muerte completa ahora tiene un coordinador server-only que conserva la reserva hasta aplicar en el tick o bloquear la autoridad. El host de la partida sigue su ruta actual; activar esta integración necesita el siguiente corte. Base 7cd3e27. [Contrato del adaptador](../briefs/m5-death-staging.md).

## Resultado

DeathStaging acepta únicamente selectors trusted de conexión/personaje y secuencia. Resuelve identidad y participantes, reserva víctima/PK de Cala y todos sus UIDs, y captura los helpers reales sobre drafts antes de IO. La consulta inicial de zona precede esa reserva: una autoridad competidora puede ganar el lane y la muerte rechaza busy; callbacks de mapa del adaptador deben ser read-only. El capture gameplay corre con la reserva instalada y una reentrada request/save/drain produce rechazo sticky incluso si el callback la oculta.

El baseline incluye EXP Float64 canónica y progreso actual. Autosaves previos se asientan bajo reserva antes de elegir versiones, las generaciones salen de storage y commitDeath envía el request exacto a la cola/diario existentes. Los awaits no matan actores, modifican perfiles/ECS/ledger, asignan IDs ni publican eventos. Guardados tardíos solo bufferizan un baseline idéntico.

Drain exige el mismo account/sesión/personaje/perfil, las filas y columnas ECS, nombres y ownership completa, sin huérfanos. Exige receipt exacto, versión confirmada y storage idle. DeathApply conserva referencias de perfil, prepara cambios reversibles, asigna IDs desde el allocator actual, remapea ledger/eventos y agrega identidad operationId/ordinal a drops ordinarios. Aplica perfil, muerte/EXP/poderes, perlas, drops, dirty marks y publicación juntos. Rechaza contenedores inseguros y usa intrinsics sin callbacks live de mutación/emit.

Una respuesta perdida puede cerrar por el recibo exacto sin duplicar pérdidas ni botín. Close/recycle/respawn/invalidation/drift o un fallo posterior dejan fence y no aplican otra vez. Rollback restaura exclusivamente el efecto local tentativo, nunca SQL confirmado; reconciliar un recibo histórico no abre ese fence. El fork de RNG de deathPlan conserva geometría/fechas sin tocar RNG vivo ni asignaciones de otros actores durante IO. Esta preparación no cierra la política de RNG/reloj del host.

Siguen las reglas acordadas: perla ligada hasta morir, EXP/bolsa/perlas perdidas globalmente, equipo no starter y pociones adicionales de Cala, PK solo allí; nivel, oro y maestría conservados. 10 % de EXP provisional; afinidad permanente todavía pendiente.

## Verificación

**1336/1336** pruebas, cero fail/cancelled/skipped/todo, **105 archivos y 348 fuentes fijas**, **50 checks nuevos** sobre 1286. Node v24.14.0. Base 7cd3e27 + seis overlays propios, hashes SHA256/LF verificados antes/después de cada cohorte y contra los overlays actuales. Salida normal de Node, sin force-exit. Duración total **493.576,0038 ms**: red 2/2 en 7.249,298 ms (concurrencia 1), núcleo 1334/1334 en 486.326,7058 ms (concurrencia 2). No equivale a aceptar el checkout compartido completo.

Memoria y SDK Supabase contra SQL001–010 local cubren cero/nueve perlas, exterior/Cala, killer exterior sin PK, bolsa/equipo/pociones y recibo perdido. También: autosave viejo más raw EXP 83.333333; generaciones managed mixtas; UID conservado del killer; reserva durante captura; cambio de XP/movimiento/progreso/columnas/perfil/client/ledger; ownership huérfana; muerte seguida de revival/invalidation; close de ambos endpoints; reentrada y mutators inseguros; allocator/RNG usados por otros actores; muertes independientes; recibo corrupto y provider outage; snapshots distintos; reconcile sin replay local; rollback de apply, publicación e identidades alteradas. Los tests anteriores de procesos y SQL siguen dentro de la cohorte fija.

- shots/review/m5-death-staging-network-accepted.log: SHA256 720061f2e7cb8670a7cf2fbd29ad410389c784f7bf274b7d6875340833042599.
- shots/review/m5-death-staging-core-accepted.log: SHA256 e005e10d9bf482da46a52e0bb248d3daf0f75392787dc13a89ef5eba3e51c98b.

La copia fija usa protocolo 19. El checkout paralelo mostró protocolo 22 durante la revisión y no se acepta por estos resultados. Three 0.160.0: 954 archivos copiados, cada SHA256 coincide con la evidencia previa; digest agregado f9dbb546718d88a8769a0038ad28aee787eaf29ec7a84995557c00da5f6ff9fe con formato explícito path + espacio + hash, líneas LF sin LF final. PGlite 0.5.8 y SDK 2.117.2 comprobados por versión; resto de node_modules enlazado sin hash completo. [Evidencia estructurada](d09f-death-staging-evidence.json).

Durante preparación una expectativa exigía una sola consulta lawlessAt, pero los helpers reales consultan zona más de una vez; se corrigió antes de la aceptación final. El primer digest agregado de dependencias usó otra serialización: la igualdad de cada archivo ya pasaba y se registró un formato agregado explícito. No se cambiaron reglas de pérdida para hacer pasar tests.

## Revisión y reutilización

AGENTS exige GPT-6 Luna: death_staging_review auditó solo lectura los contratos y los dos módulos. El principal implementó, integró y aceptó con pruebas propias. Se cerraron reentrada, reserva antes del capture gameplay y límites de callbacks/rollback/publicación. La propuesta inicial de cambiar returnAt de perlas fue descartada al verificar groundData: expiresAt corresponde a drops ordinarios. La revisión final no encontró bloqueantes en readiness/identity o EXP crudo; el preflight de zona anterior a la reserva está delimitado arriba.

Inventario Unreal/FAB cruzado y candidatos BP_JigServerSave (580.554 B) y BP_InventoryComponent (24.878.603 B) reverificados en ActionRPGMultiplayerStart. Son Blueprints sin ejecución en Node/CAS. Se reutilizan captura/helper real, DTO, sessions, journal/cola/gate. Fuentes Unreal intactas, sin assets nuevos.

## Estado real y siguiente corte

El autor confirmó que SQL010 corrió sin error el 2026-10-07. No se hizo canario Supabase real ni se leyeron credenciales. **No hace falta SQL nueva para este corte.** Sin host/combate conectado, env/protocolo nuevo, push/deploy o reinicio del PC.

Sigue integrar muerte antes del helper local y freeze de actores, publicación/respawn/lifecycle en GameHost; después suelo ordinario durable actual con hidratación, pickup/consumo/expiry. listDeathDrops sigue siendo creación histórica. Afinidad permanente, clock/epoch/políticas/RNG definitivos, leases y finalizador abiertos; P4/P6 parciales. Rebuild de autoridad tras fence y detección de ciclos transitorios requieren invalidación explícita del caller; las pruebas no prueban ese montaje en la partida.

Solo los diez paths propios se incluyen en el commit. Se conservan cambios navales, visuales, chat y LLM ajenos y se comprueba la huella del diff ajeno inmediatamente antes/después del commit. El cierre verifica también hashes de los blobs runtime/test commiteados contra los overlays aceptados.
