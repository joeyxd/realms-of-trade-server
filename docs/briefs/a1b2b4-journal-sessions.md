# A1b2b4 — sesiones autenticadas con diario y recuperación

2026-10-09. Continúa A1b2b3 en el banco comunitario aislado.

**Revisión de responsabilidad del autor:** M5 lleva la continuidad de la partida. Este controlador
se conserva como contrato/regresión; no iniciar desde A1 otro montaje de sesiones en GameHost.
La integración jugable usa una sola mochila bajo M5 y reutiliza las reglas de aportes:
[frontera A1/M5](a1-m5-authority-boundary.md).

## Resultado

Integrar la barrera de `CommunityOperationRecovery` con `BoundProfileSessions`, reutilizando
su identidad autenticada, reservas y publicación síncrona de `ScopedProfileSessions`.
La opción `operationStore` activa este camino; el constructor sin ella conserva su contrato anterior.
No crear otra mochila, migración ni controlador de identidad paralelo.

## Contrato

- Scope fijo de servidor y vínculo durable existente. Los stores de personaje y operaciones deben
  apuntar a la misma autoridad SQL comunitaria; no mezclarla con `mn_profiles` de M5.
- La barrera comienza cerrada. `recoverWorld()` escanea y reconcilia sin escribir por defecto;
  solo abre sin pendientes ni peticiones locales inciertas. No admite durante el scan.
- `save` genera UUID en servidor; `contribute` conserva el UUID del aporte y su baseline original
  al repetirlo. Ambos envían prepare → commit por el diario, sin writers ordinarios directos.
- El mismo personaje permanece ocupado hasta publicación o recuperación/cierre resueltos.
  Otras cuentas pueden avanzar durante I/O normal; una incertidumbre cierra la barrera del scope.
- Close/revocación antes de prepare impide escribir. Si ocurre mientras prepare responde, no se
  despacha commit: el pendiente durable exige recuperación. Una petición de commit ya despachada
  puede terminar; su respuesta tardía no devuelve el perfil ni revive la conexión anterior.
- `recoverWorld` rechaza ejecución durante admisión, mutación, recuperación de sesión o `drain`.
  `recoverWorld({retry:true})` es una acción interna explícita y masiva que usa peticiones originales.
  No exponerla al protocolo de jugadores. `recover(client,{retry:true})` se rechaza en modo diario.
- Después de recuperar la barrera, `recover(client)` lee la operación exacta terminada y recarga
  personaje/proyecto actuales. Falta de evidencia conserva el intent en la barrera; un resultado
  histórico nunca sustituye una revisión actual más nueva.
- Las promesas solo preparan estado. `drain(publish)` exige publicación atómica y síncrona en
  el tick del propietario. Callback async/thenable/throw no entrega token nuevo; el publisher
  debe revertir sus propias escrituras si falla. Close reentrante se difiere hasta terminar drain.
- Cierre con operación incierta conserva reservas hasta recuperación. La recuperación administrativa
  de una sesión cerrada es interna, sin publicación ni envío de evidencia privada a ese cliente.

## Aceptación y límites

Probar memoria y SDK Supabase real sobre PostgreSQL local: flujo completo/reapertura limpia,
respuestas perdidas antes/después de commit, rollback al cerrar diario, CAS terminal, replay,
filas actuales más nuevas, auth reemplazada, cierre/preflight/prepare/reload, scan durante sesión,
evidencia ausente y publicación fallida. Regresión comunitaria previa; no suite completa del juego.

La integración a cargo de M5 debe mantener autosave y todas las mutaciones de gameplay en un solo owner,
incluidos comercio, fabricación, perlas y muerte. Este banco no exige sustituir `ProfileSessions`
por `BoundProfileSessions`. GameHost/M5 no cambian en este corte; no aplicar
SQL live, leer `.env`, reiniciar host ni activar UI. Alpha.16/protocolo 32 y costes conservados.
La barrera sigue siendo de un proceso: no demuestra lease, handoff o failover concurrente.

## Reutilización

Cruce puntual con `docs/research/unreal-assets/survival/FINDINGS.md`; existencia de
`SM_RepairBench.uasset` y `SM_StoragePart_03.uasset` comprobada bajo
`C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\Assets\Meshes`.
Son candidatos visuales del taller/receptor, sin autoridad o diario portable. Este corte reutiliza
contratos, barrera y sesiones del repositorio; no incorpora arte ni modifica fuentes Unreal.
