# D09f-2b.30 — hidratación conjunta del suelo actual

Base: 342c026f3ffcfdd958f8507c688ebe4ac43c5440. Implementar y aceptar en copia fija antes de integrar; conservar el checkout paralelo.

Extender PearlGroundHydration/PearlStartup con deathDrops:true opcional, apagado por defecto.
Un único gate pasa recuperación → lectura conjunta → instalación síncrona; cero huecos de admisión.
El lector ordinario pagina listCurrentDeathDrops, valida cada fila contra loadDeathDrop y su recibo
inmutable de muerte, y repite el scan. No usa listDeathDrops histórico para crear suelo. picked/expired
no se reconstruyen; una intención sin recibo mantiene reservas y cerca startup, sin auto-resume.

Preparación asíncrona solo lee. drain instala perlas primero y después objetos/pociones con IDs locales
nuevos y UUID/ordinal persistidos, en un único plan reversible. Tick/Map/contador distintos, fuentes
ya marcadas, páginas malformadas, drift y exceso de filas fallan sin un prefijo visible. Máximo por
familia: maxRows; la suma exige capacidad entera segura del contador. Datos y contenedores ordinarios
se validan sin ejecutar getters/Proxy/métodos Map sustituidos. Retener objetos legacy ajenos.

availableAt/expiresAt ordinarios pasan intactos a pickAt/t. No reloj de pared, rebasing desde cero,
expiry, eventos históricos, RNG, perfiles, quest o callbacks durante apply. Suelo vencido sigue siendo
estado ground hasta su transición autorizada posterior. idempotencia de drain y rollback total ante
fallo tardío del contador; comparar perfil/recibo durable antes/después del ensayo.

Este adaptador no demuestra un tick durable, envejecimiento offline, snapshot transaccional entre
páginas ni lease entre procesos. WorldState guarda economía; no usar ese reloj como sustituto del
suelo. GameHost todavía rechaza deathDrops en mountPearlStartup, aunque su lifecycle opcional existe.
Cerrar epoch/reloj y conectar esa barrera al host es el siguiente corte antes del piloto real.

Unreal/FAB: revisar solo lectura SM_Potion.uasset (117.402 bytes) y BP_InventoryComponent.uasset
(24.878.603 bytes) en C:\Unreal\ActionRPGMultiplayerStart\Content\ActionRPGStarterSystem. Son candidatos
visual/Blueprint, sin autoridad PostgreSQL portable para esta restauración. Reutilizar DTOs, gate,
journal y reader existentes; fuentes intactas, sin export ni arte nuevo.

Aceptar memoria y SDK/SQL001–012: paginación, ambos estados terminales, varios ticks explícitos,
recuperación de reply perdido sin duplicar, intent exacto sin receipt, cancelar/IO lento, segundo scan,
source/receipt alterados, rollback combinado y recogida real tras hidratar seguida de nueva reconstrucción.
Regresión aislada y comprobación enfocada en checkout compartido con fuentes vigiladas. Sin SQL/env,
protocolo, push/deploy o reinicio. SQL010 confirmada por el autor; SQL011/012 real por confirmar.
