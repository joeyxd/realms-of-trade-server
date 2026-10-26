# D09f-2b.9 — arranque de perlas con una barrera común

2026-10-06. El arranque anterior tenía piezas separadas: recuperar diario podía marcar la queue
disponible antes de reconstruir el suelo. `PearlStartup` conserva una sola barrera desde el primer
await de recuperación hasta la instalación síncrona; una cuenta o UID desconocido tampoco puede
entrar por esa ventana. [Contrato](../briefs/m5-pearl-startup.md).

## Comportamiento implementado

- `start()` compartido recupera recibos existentes y prepara suelo actual, sin enviar operaciones
  que carezcan de recibo ni repetir efectos históricos. Exige diario/scope y mapper explícitos.
- El gate transfiere su handle opaco entre recuperación e hidratación con queue vacía, sin liberar
  la barrera. Pending sin recibo conserva request/UUID/lanes y cerca el arranque completo.
- Solo `drain()` síncrono instala drops/ledger y marca ready. Captura anterior a recuperación detecta
  cambios de tick/maps/contador; el adaptador existente conserva validación y rollback de instalación.
- Cancelar durante recuperación/carga o antes de drain impide aplicación tardía. IO iniciado puede
  acabar/reconciliar el diario; no desbloquea la barrera ni modifica World. Runtime ready requiere
  lifecycle del host para cerrar, sin deshacer lo ya aplicado.

## Verificación

**814/814 pruebas pertinentes pasaron**, 38 archivos sobre archivo Git aislado
`0a485e3` más siete fuentes propias; Node v24.14.0, concurrencia 2.
**56 nuevas:** 23 de contrato en memoria, 23 del mismo contrato SDK/SQL001–008 y 10 del gate.
Cero fallos, cancelaciones, skips o TODO. Hashes de siete fuentes propias y
77 seleccionadas sin cambios antes/después.
[Evidencia, comando y SHA-256](d09f-pearl-startup-evidence.json).

El runner previo de imágenes SQL/procesos está incluido; esos procesos prueban reconstrucción del
adaptador de suelo existente, no un restart de GameHost ni del nuevo coordinador. Se conservan las
cuatro exclusiones NodeFS/canario de la aceptación anterior: hashes verificados, sin sumarlas como
checks actuales. Pruebas locales sin credenciales ni red externa; no es toda la suite del juego.

## Reutilización y límites

Verificados de solo lectura `BP_JigServerSave.uasset` (580.554 B) y
`BP_InventoryComponent.uasset` (24.878.603 B), ActionRPGStarterSystem/InventorySystem en `C:\Unreal`.
No hay autoridad Node/CAS portable; se reutilizan recuperación, diario, gate e hidratación del repo.
Fuentes Unreal intactas, sin nuevo arte.

Este coordinador sigue dormant: GameHost/LocalServer/sim/cliente/protocolo no cambian, no hay SQL/env
nueva ni reinicio/despliegue/live Supabase en el corte. Afinidad permanente y muerte completa
equipo/oro/mundo permanecen pendientes. La barrera es de una autoridad; no es lease/snapshot SQL
entre hosts. Archivos de arte/naval y HANDOFF/PLAN-DELIVERY con cambios paralelos se conservan.

Próximo corte: integración del host y hooks completos del
[mapa común](../briefs/m5-pearl-common-gate.md), con scope/reloj/adopción definidos. El host deberá
mantener sim/listener/admisión detenidos hasta ready y esperar la Promise de startup al cerrar;
`ProfileSessions.flush` conserva su rechazo de pendientes. Sin activar solo una ruta de perlas.
