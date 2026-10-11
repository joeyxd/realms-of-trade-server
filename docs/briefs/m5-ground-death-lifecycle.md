# AREA15: muerte y botín bajo el reloj común

Continuación de [perlas actuales](m5-ground-pearl-lifecycle.md). El corte conecta la captura real
de muerte, sus pérdidas y crédito PK, y el consumo/expiración de objetos y pociones. Conserva
`GroundHostAuthority` como único dueño de `beforeTick`, SQL018/019/023 y reloj operativo.

El montaje explícito `mountGroundPearls(); mountGroundDeaths();` ocurre con host vacío y detenido,
antes de `prepare()`. No añade flag, SQL, dispatcher público ni adopta el mundo VPS. Montajes legacy
de perlas/muerte/botín siguen siendo excluyentes. Mint de enemigos/cofres y comandos restantes de
perlas siguen pendientes; no se acepta todavía la activación pública de toda la composición.

Un tick terminal termina una sola vez. `CombatDeath` conserva la causa y retiene publicación;
las muertes se procesan en orden, con reservas de cuentas, UIDs y fuentes de botín tomadas por
la autoridad común antes de cualquier espera. Se asienta el progreso ECS capturado y se leen las
generaciones de las perlas. Ese guardado previo no aplica ni publica muerte. SQL019 prepara el
sobre exacto y SQL018 confirma pérdidas, perfiles, ubicaciones, botín, mundo y reloj juntos.

Solo el drain síncrono aplica ECS, perfil, metadatos de sesión, comandos neutralizados, fuentes
actuales y eventos. Un resultado preparado no ejecuta gameplay. Las muertes simultáneas comparten
versiones confirmadas: el atacante puede ser víctima de otra muerte del mismo tick. La reaparición
empieza después del efecto confirmado, con las reglas de combate existentes.

La geometría se captura con el fork de RNG ya existente. Durante IO el mundo completo queda
detenido. En el drain se exige el cursor y referencia originales; al aplicar se avanza al cursor
del fork. Un fallo revierte exclusivamente ese reemplazo y las escrituras tentativas del efecto.
No se afirma conservar el cursor RNG de loot entre procesos: la fuente durable es la geometría
confirmada, no una reproducción del tick histórico.

La hidratación conjunta instala únicamente filas actuales de perlas y botín. Sus deadlines usan
el mismo epoch recuperado y pausa offline acordada. La recogida de objetos/pociones comprueba
cuenta viva, rango, capacidad, fuente y ventana; asienta progreso antes del recibo. La expiración
no requiere jugador. Cada fuente ordinaria conserva `operationId:ordinal` y termina una sola vez.

Cambio de identidad/contenedor, deriva de ECS/RNG/ventana, respuesta inválida o replay inesperado,
desconexión y cierre durante una operación impiden efectos tardíos. Tras ambigüedad se conserva el
recibo durable y se cerca la autoridad; shutdown no drena gameplay histórico ni promete flush completo.

Validación requerida: terminal fatal real, Cala/exterior, cero perlas, varias muertes, atacante ya
muerto, progreso pendiente, cola de inputs, aplicación reversible, recogida/expiración y reinicio.
SIGKILL local con PGlite persistente tras prepare y tras commit, reapertura sin migraciones y
recuperación antes de hidratar; cuentas sin duplicados y cero eventos históricos. Regresión con
recursos/taller/Carga/agua/terreno y montajes legacy. La evidencia local se separa del VPS.

Reutilización revisada: `BP_JigServerSave` de ActionRPG y `BP_LootBox`/`BPC_SMSK_LootComponent`
del inventario [Unreal](../research/unreal-assets/README.md) describen guardado/loot en Blueprint.
No ejecutan Node/Postgres ni aportan este contrato CAS/diario. Se reutilizan los planes/efectos JS
existentes; no se copia ni modifica arte o fuentes Unreal. Activación GM con piloto de suelo montado
mantiene su exclusión v1; no se amplía silenciosamente su aceptación.
