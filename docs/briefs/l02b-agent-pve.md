# L02b — cuerpo PvE

2026-10-08. Continuación autorizada tras L02a. Raíz diseña, integra y acepta;
Luna implementa el controlador puro y revisa pruebas en archivos exclusivos.
Checkout compartido conservado; fuentes Unreal de solo lectura.

Orden local `body_pve`, explícitamente habilitada junto a `move`, `aim` y
`attack_pve`, con modo agresivo, defensivo o apoyo, horizonte acotado, umbral
de retirada y permiso separado dentro de la orden para consumir pociones propias.
Una tarea del cuerpo a la vez. Se observan HP, estado de ataque, bloqueo de acción,
guardia y reservas/recarga de poción del snapshot propio antes de reconciliar.
No se modifica el protocolo, ECS, host, daño, inventario o tiempos del juego.

Agresivo persigue enemigos observados dentro de un radio local; defensivo cubre
su posición y contraataca cerca; apoyo acompaña a una referencia viva de jugador,
se coloca entre ella y el enemigo cercano y cubre con guardia. HP bajo prevalece
y provoca retirada. Inputs ordinarios de movimiento, apuntado, ataque, guardia
y poción; sin habilidades especiales, dash, curación de aliados ni LLM por paso.
El guard de ensayo se conserva: cualquier otro jugador observado a menos de 8
unidades suprime los ataques del cuerpo, incluido el personaje protegido. Apoyo
no promete alterar el aggro, absorber todos los proyectiles o asegurar supervivencia.

Feedback actual acotado del modo/amenaza/retirada/bloqueo, con tick y antigüedad
de observación reales. Pulsos sujetos a reservas observadas y cadencia local;
el servidor sigue resolviendo consumos, recargas, daño y colisiones. Inicio de
swing o consumo confirmado son efectos parciales, nunca victoria/protección final.
Stop/cancelación/caducidad/estado obsoleto/muerte conservan incertidumbre enviada.
L02c sigue pendiente para permisos y revocación del servidor.

Reutilización antes de implementar: existen
`C:/Unreal/survival project/SimpleMultiplayerSurvival/Content/Dreamrise_SMSK/Blueprints/BP_ZombieAI.uasset`
(477.784 B) y
`C:/Unreal/ActionRPGMultiplayerStart/Content/ActionRPGStarterSystem/AI/Behavior/Tasks/BP_AttackEnemy.uasset`
(72.649 B). También se verificaron por ruta `BP_CheckCanExecuteSkillOnFriendly`
y `DA_AISkill_AoeHeal` en ese proyecto. El [inventario](../research/unreal-assets/CANDIDATES.csv)
solo acredita nombres/rutas y algunos símbolos serializados; grafos/dependencias
no verificados. Blueprint/DataAsset no ejecutables en Node: descarte de lógica
portable. Se reutilizan controles/combate del juego y el patrón de watchdog L02a;
`tools/botbrain.mjs` es referencia, requiere hazards/predicción y no se conecta.

Aceptación: modos deterministas, permisos/argumentos/horizonte, supresión PvE,
reservas/recarga, retirada/progreso/bloqueo, cancelación y ciclos de vida. Encuentro
controlado por WebSocket real con personajes invitados: atacar con daño normal,
guardia/interposición ante amenaza, retirada y consumo de poción/recarga reales,
obstáculo sin teletransporte. Fixtures de mapa/spawn explícitas. Regresión agentes,
chat/red y combate pertinente. Sin proveedor/gasto/publicación ni cambio visual.
