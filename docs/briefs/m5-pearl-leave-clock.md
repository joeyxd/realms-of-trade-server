# M5 / D09f-2b.35 — dejar perlas con plazos durables

Base 241edb9. Convertir solamente PearlStaging.#leave al dominio explícito GroundDeadlineClock de
restauración/muerte .33/.34. El selector toma una perla de la bolsa; tragada sigue ligada hasta muerte.
No añadir pickup, spit, replacement, venta o retorno ni activar el host.

Constructor deadlineClock opt-in, auténtico y del mismo scope. Antes de reserva/save/loadUnique/commit,
capturar tick local y mapear availableAt desde pickAt y returnAt desde t del helper detached leavePearl.
Validar round-trip/rangos y proyectar marker sobre el drop local sin cambiar tiempos/geometría/eventos.
Sin opción, conservar DTO/drop legacy. No modificar World.tick, perfil, protocolo o fórmula de pérdida.

Ligadura privada del plan de leave y tick capturado; solo resolución gestionada puede sustituir plan
para obtener generación vigente. Congelar/ligar request exacto al construirlo. Antes de dispatch/drain,
validar plan privado, epoch y tick no anterior a captura; antes de aplicación comparar recibo válido y
ground/UID/kind con la ligadura. Usar stagedDrop y rollback/fence existentes. Async nunca escribe World.
Avance del tick durante I/O conserva los plazos capturados. No es lease ni autoridad entre procesos.

Pruebas: offset durable >2^32, helper/eventos originales, respuesta perdida/replay, generación avanzada,
reloj forjado/Proxy/mundo equivocado, overflow/ancla futura antes de I/O, retroceso, plan/request/receipt
alterados y rollback local con recibo conservado. SDK/SQL001–013 local: leave real, restauración desde
tick cero, checkpoint desde reloj recargado y segunda restauración con disponibilidad pasada negativa.
Conservar regresión de staging/inputs/perfiles/reservas y ground recovery; aislar trabajo compartido.

Sin migración ni credenciales/Supabase live/defaults/host/env/push/deploy/reinicio. Dominio legacy no
certificado, pickup/retorno de perlas, atomicidad reloj/gameplay y ventana de crash, política offline,
cadencia/startup/leases y aceptación real pendientes; afinidad por personaje/tipo y P4/P6 siguen abiertos.

Unreal/FAB: comprobados solo lectura BP_InventoryComponent.uasset (24878603 bytes) y SM_Potion.uasset
(117402 bytes), ActionRPGMultiplayerStart. No aportan autoridad JS/Postgres de tiempos/recibos. Reusar
leavePearl, GroundDeadlineClock, stagedDrop, ProfileSessions y pruebas/SDK existentes; ningún asset nuevo.
