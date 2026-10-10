# Continuidad de servidor — AREA15

2026-10-10, hora de México. M5/GameHost mantiene una sola autoridad de persistencia.

| Recorrido | Cobertura | Próximo cierre |
|---|---|---|
| Comercio, materiales de balsa, carga y aportes | SQL014, perfil/mundo/recibo y aceptación publicada | Caída VPS y nuevas operaciones |
| Recolección, golpes parciales, crafting y herramientas | [SQL015/alpha.23](delivery/m5-resource-authority.md), activa en Supabase; 57/57 runtime, 107/107 offline VPS, 8 acciones confirmadas y 23 replays tras dos reinicios ordenados y SIGKILL | Otras operaciones/features M5; la durabilidad de recursos no acredita cortes eléctricos ni restauración de disco |
| Reloj de recursos | Tick lógico en commit/checkpoint; reinicio ordenado con pausa offline real de 12 918 ms y espera recalculada exacta de 43,9 s | El tiempo de simulación sin checkpoint puede retroceder ante caída abrupta |
| Aprendizaje y otros campos del perfil | [PRG01b2/SQL016](delivery/prg01b2-logging.md): Tala, troncos y hasta tres perfiles actuales en el mismo recibo M5; legacy/pilotaje preservados | SQL016 y activación/aceptación VPS; después enseñanza del artesano |
| Mercados y producción autónoma | Snapshot periódico y operaciones económicas cubiertas | Ventana desde último checkpoint |
| Construcción, pose y custodia de balsa | Perfil; carga y compra de materiales con recibo | Nuevas operaciones durables y custodia offline |
| Perlas/muerte/botín | Contratos M5 opcionales; no compuestos con economía activa | Dueño común de tick y transacciones de gameplay |
| Operación y respaldo | Updater de una autoridad, perfiles y mundo en Supabase | Ensayo de restauración y pérdida de disco |

La revisión desplegada es `a5b8f127340c1febbd4c0b29cb83bbc2fa83fe98`, alpha.23/protocolo 36; la
activación inicial fue en `4c6743b87b71ba765e316cd1652d1e4f23991501`. El commit actual solo añade
docs/herramientas GM/AREA17 sobre el mismo runtime. El status final confirma `/health` 200, un
contenedor sano, timer activo, tick avanzando, ambos flags habilitados y cero errores, jugadores,
sockets, operaciones pendientes o guardados sin confirmar. La imagen pasa 107/107 offline.
Los ocho gathers/crafts
se confirmaron mediante commit/recibo; el checkpoint periódico registra el reloj/mundo, no sustituye
esa confirmación. Los recibos se reprodujeron 7+8+8 veces tras dos reinicios ordenados y SIGKILL
después del ACK. La prueba local cubre cuatro ventanas antes/después de commit. En VPS, el contenedor
terminó con exit 137 y se inició manualmente; no se demuestra autoreinicio Docker. El corte no prueba
tolerancia a pérdida eléctrica, disco perdido/restauración ni durabilidad de otras features M5.

El [status final](delivery/m5-resource-authority/final-live-status.json), [SIGKILL](delivery/m5-resource-authority/crash-restart.json)
y [cleanup](delivery/m5-resource-authority/cleanup-verification.json) registran el estado desplegado,
la recuperación y la eliminación de la cuenta QA: Auth/perfil ausentes y ocho recibos/recursos conservados.

El aprendizaje `pilot_coastal` de AREA07 es una concesión de progresión distinta; no es un grant de
recursos ni amplía el alcance de aceptación de AREA15.

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
