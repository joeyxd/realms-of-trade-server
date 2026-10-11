# AREA15 — familias de suelo en la frontera común

Base `860990c`, después de taller/Tala SQL024/026, controles SQL027, natación, purificador y GM04a.
SQL023 está instalado en el VPS; su mundo continúa sin adoptar ni activar el montaje común.

## Corte

`GroundHostAuthority.stageFamily({ operationId, family, operation }, apply)` recibe exclusivamente
las familias existentes `ground`, `batch`, `death` y `drop`. `operation` es la petición canónica de
esa familia, sin UUID exterior. La API pertenece al ensamblaje de confianza del servidor; no acepta
comandos de red, versiones de mundo ni snapshots elegidos por un cliente.

El dueño común captura mundo, versión y tick lógico; valida antes de reservar. Mantiene una sola
operación, el bloqueo de WorldState y las reservas de cuentas, todos sus UID y claves de botín.
No comienza con joins, guardados de perfiles o checkpoints pendientes. Una reserva invalidada por
desconexión no permite aplicar el resultado.

SQL019 prepara el sobre exacto y SQL018 confirma familia, mundo y reloj juntos, bajo el cerco de
SQL023. La continuación asíncrona solo deja el resultado preparado. El único `beforeTick` llama
`apply(effect, { reservation })` sincrónicamente; exige `true`, verifica que el mundo no cambió,
avanza sus metadatos y libera la reserva. La promesa se resuelve después de esta aplicación.

El adaptador de la familia conserva la responsabilidad de elegibilidad, baseline, geometría,
aplicación reversible del perfil/ECS y metadatos de ProfileSessions. El token permite sus guardados
internos autorizados; nunca se serializa. Una excepción, resultado asíncrono, cambio de dueño, tick,
snapshot o reserva cerca el mundo. El cierre espera persistencia pero no ejecuta este adaptador;
un reinicio resuelve el diario y carga filas actuales, sin reproducir callbacks históricos.

Un reintento de transporte usa el mismo sobre congelado. Reenviar un UUID histórico mediante una
nueva captura de mundo no reconstruye su petición antigua y debe rechazarse. El replay SQL exacto
no restaura un snapshot histórico.

## Alcance y continuación

No añade SQL, flags, protocolo ni otra autoridad. Las rutas legacy y el runtime normal conservan
su configuración. Esta entrada todavía no conecta los selectores, hidratación y coordinadores
autónomos de perlas/muerte/botín; montarlos requiere conservar su orden y sus adaptadores de
aplicación, con el mismo dueño de `beforeTick`. No adoptar el mundo público hasta completar ese
ensamblaje y la transición detenida bajo exclusión del actualizador.

La aceptación debe probar las cuatro familias con SQL real local, ausencia de aplicación antes
del drain, reservas, fallos y cierre, replay/recuperación y compatibilidad con recursos v3/taller.
Dos SIGKILL cubren intención preparada y commit confirmado antes de aplicar. No acreditan caída
del VPS, pérdida de disco/energía, concurrencia entre backends PostgreSQL ni hidratación jugable.

Reutilización: SQL018/019/023, GroundTransactionSession, PearlMutationGate y los DTO existentes.
El [inventario Unreal](../research/unreal-assets/CANDIDATES.csv) incluye `BP_JigServerSave.uasset`
en `C:\Unreal\ActionRPGMultiplayerStart\Content\ActionRPGStarterSystem\InventorySystem\SaveSystem`
(580554 bytes, verificado en este corte). Su Blueprint es referencia de flujo, sin ejecución
compatible con Node/PostgreSQL; no se porta código ni arte ni se modifica el proyecto fuente.
