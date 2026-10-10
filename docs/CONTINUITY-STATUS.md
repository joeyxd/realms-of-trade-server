# Continuidad de servidor — AREA15

2026-10-10, hora de México. M5/GameHost mantiene una sola autoridad de persistencia.

| Recorrido | Cobertura | Próximo cierre |
|---|---|---|
| Comercio, materiales de balsa, carga y aportes | SQL014, perfil/mundo/recibo y aceptación publicada | Caída VPS y nuevas operaciones |
| Recolección, golpes parciales, crafting y herramientas | [SQL015/alpha.22](delivery/m5-resource-authority.md), 176 pruebas integradas y cuatro caídas de proceso locales | Activación y aceptación autenticada VPS |
| Reloj de recursos | Tick lógico en el mismo checkpoint/transacción; pausa offline aprobada | Registrar reinicio real; una caída puede perder tiempo aún no checkpointado |
| Aprendizaje y otros campos del perfil | [PRG01b2/SQL016](delivery/prg01b2-logging.md): Tala, troncos y hasta tres perfiles actuales en el mismo recibo M5; legacy/pilotaje preservados | SQL016 y activación/aceptación VPS; después enseñanza del artesano |
| Mercados y producción autónoma | Snapshot periódico y operaciones económicas cubiertas | Ventana desde último checkpoint |
| Construcción, pose y custodia de balsa | Perfil; carga y compra de materiales con recibo | Nuevas operaciones durables y custodia offline |
| Perlas/muerte/botín | Contratos M5 opcionales; no compuestos con economía activa | Dueño común de tick y transacciones de gameplay |
| Operación y respaldo | Updater de una autoridad, perfiles y mundo en Supabase | Ensayo de restauración y pérdida de disco |

Cada feature que concede progreso debe declarar dato/dueño/scope, defaults/migración, confirmación,
ID estable, recibo/replay y recuperación. Material, práctica y recompensa derivados de una acción
pertenecen a su misma transacción; no concederlos luego de confirmar por un autosave independiente.
Registrar por separado implementación, pruebas, SQL, publicación y activación. Ver el
[contrato de recursos](briefs/m5-resource-authority.md) y [PLAN-M5](../PLAN-M5.md).

PRG01b2 declara `progression` como dato del perfil de cuenta en el único mundo alfa. M5 reserva
cuentas/UIDs conectados; SQL016 compara los perfiles actuales de todos los contribuyentes y confirma
su práctica con nodo/reloj/recibo. Ausencia legacy sigue representando cero sin reescribir recibos;
recursos v1 se adoptan una vez sin inventar autoría en ciclos parciales. Replay histórico no instala
estado antiguo y la recuperación local se comprueba terminando el proceso antes/después del commit.
Scope por personaje/mundo/época y aceptación de una caída real del VPS permanecen pendientes.
