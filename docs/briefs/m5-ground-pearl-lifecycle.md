# AREA15 — recuperación y circulación de perlas en la autoridad común

Base `2f5df93`, integrada con taller/recursos v3, HUD, navegación, GM e inferencia alpha.42.
SQL023 ya instalado; el mundo público sigue sin adoptar. No añade SQL, protocolo ni flag público.

Este corte conecta un piloto de confianza `GameHost.mountGroundPearls()` antes de `prepare()`.
Conserva el único `GroundHostAuthority.boundary`, cuentas autenticadas, cero bots y mundo ya
adoptado/coherente. Nunca intenta adoptar el mundo legacy desde el arranque normal.

Después de resolver SQL019 y restaurar el mundo/reloj, prepara las filas actuales de perlas y
botín con paginación, verificación de fuentes y segunda lectura, bajo la barrera existente.
Un drain síncrono detenido instala las perlas. Los plazos se proyectan desde el tick lógico
recuperado hacia tick local cero: el apagado no envejece las perlas. No reproduce callbacks
históricos ni aplica expiración durante las lecturas. Si encuentra botín ordinario, falla antes
de instalarlo o admitir jugadores: su coordinador común pertenece al siguiente corte.

La recogida y devolución de una perla hidratada construyen la familia `ground` con la versión
de la fila actual. La autoridad común reserva cuentas/UID, prepara el diario y confirma operación,
mundo y reloj juntos. SQL preparado no cambia perfiles, drops, ledger ni eventos. El único
`beforeTick` aplica un adaptador síncrono reversible y luego avanza la versión del mundo.
La recogida actualiza en ese mismo apply la versión, confirmed y last de ProfileSessions,
sin otro save del perfil previo. La devolución conserva UID, geometría determinista, orden de
drops, RNG y allocator locales; la nueva ubicación/version queda disponible para otra recogida.

Los selectores automáticos conservan cadencia de tres ticks, ventana de disponibilidad,
proximidad, jugador vivo y bolsa llena. Las entradas manuales son selectores exclusivos del
ensamblaje del servidor, nunca comandos de red o snapshots/versiones elegidos por el cliente.
Desconexión, cambio de baseline/owner, fallo de proyección o cierre ambiguo cercan la autoridad;
el arranque posterior carga las filas actuales confirmadas, sin aplicar efectos viejos.

La aceptación exige SQL real local, recogida autenticada, commit retenido hasta drain, CAS de
perfil/mundo, devolución y recogida posterior, reinicio sin callbacks históricos y SIGKILL antes
y después del commit. Revisar también economía, taller/Tala, agentes y el host por defecto.

No cierra captura completa de muerte, consumo/expiración de botín ordinario, mint de loot nuevo,
give/swallow/leave/batch, custodia offline, XP/misiones, producción o backups. No activar este
piloto en el VPS hasta componer esas rutas y hacer la transición detenida, con exclusión del
actualizador y aceptación autenticada de caída/reinicio. Publicar las APIs no equivale a montarlas.

Reutilización: GroundHostAuthority, SQL018/019/023, PearlGroundHydration, GroundDeadlineClock,
PearlMutationGate y helpers de gameplay existentes. El candidato Unreal `BP_JigServerSave.uasset`
en `C:\Unreal\ActionRPGMultiplayerStart\Content\ActionRPGStarterSystem\InventorySystem\SaveSystem`
se volvió a comprobar como archivo existente; su Blueprint no ejecuta en Node/PostgreSQL.
Se reutilizan los contratos actuales; no se porta código/arte ni se modifica la fuente Unreal.
