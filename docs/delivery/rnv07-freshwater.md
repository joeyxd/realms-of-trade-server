# RNV07a — cubeta, manantial y reserva naval

Implementación local en alpha.44 / protocolo 50, integrada con atributos SQL029 y SQL030. Este documento registra implementación y QA locales; no declara publicación ni activación pública.

## Circuito jugable

`U` en escritorio o **Agua / Water** en touch abre el panel. Fabricar una cubeta cuesta 2 tablas de la mochila; es reutilizable, lleva 4 unidades, ocupa 2 de volumen y pesa 1 más su contenido. También aparece en el inventario. El manantial está en UV (-69, 15), marcado en minimapa y mapa grande, junto al arquero existente. Recoger tarda 120 ticks (2 segundos activos) y se interrumpe por movimiento, daño, combate o salida de alcance. Vencer enemigos no genera agua ni desbloquea una fuente permanente.

El constructor ofrece **Barril de agua dulce**: cuesta 4 tablas, tiene 25 HP, pesa 2 vacío y admite 20 unidades. Empieza vacío; su contenido se guarda por identidad estable `pN`, separado de mercancías. Depositar o retirar requiere cubeta, propiedad, cercanía e integridad. No se puede desmontar lleno; la rotura conserva el contenido y reparar recupera acceso. Desmontar vacío usa el salvamento normal de hasta 2 tablas según condición. Solo se monta en balsa en este corte; las casas requieren construcción terrestre.

**Vaciar en provisiones** convierte contenido de cubeta en la mercancía existente `agua`, sin duplicarlo. No añade consumo ni cantimplora; esas acciones corresponden a RNV07b con supervivencia. Los costes y capacidades son tuning inicial ajustable. El purificador actual conserva su comportamiento durante la transición.

## Autoridad y compatibilidad

M5/GameHost sigue siendo el único dueño. Se usa la tabla `mn_economic_operations`, el namespace UUID, CAS de perfil/mundo, ACK después del recibo y recuperación de respuesta incierta. `hold.vessels` es un campo opcional estricto de hasta 32 recipientes; la ausencia histórica sigue significando vacío. La cubeta solo va en mochila; el barril solo se acepta con parte y condición coincidentes. Peso, volumen y límites navales incluyen el contenido una sola vez. Las demás familias económicas conservan los recipientes; el escritor base renombrado queda cerrado a `service_role`.

[SQL030](../../server/migrations/030_freshwater_operations.sql) se aplica después de SQL029 y conserva recibos históricos, atributos y permisos de servicio. `MN_FRESHWATER_OPERATIONS=1` exige readiness 1 antes de admitir jugadores. La configuración local/worker permite el circuito; el VPS requiere migración y activación verificadas. Este corte no habilita suelo común, otro guardado ni otra sed.

## Arte y mapa

Se verificó el candidato concreto `C:\Unreal\MyProject\Content\_SplineVFX\Demo\Geometry\Meshes\Barrel.uasset` (40.964 bytes), pero no se aceptó por portabilidad. Se reutilizan las proporciones y geometría procedural del barril existente en el renderer de balsa y una poza sencilla de piedra y agua, sin editar Unreal ni el terreno. La fuente está centralizada en `src/data/freshwater.js`; un mapa nuevo debe declarar una fuente válida y su encuentro. La proyección de minimapa y mapa sigue compartida, sin depender de coordenadas CSS.

## Verificación local

- Host autenticado: cubeta pagada, recogida interrumpida y temporizada, replay exacto o cambiado, respuesta de commit perdida, ACK retenido, reconexión, barril pagado, depósito/retiro y retiro lleno denegado.
- SQL real en PGlite: migraciones 001–030, recibos/replay, falsificaciones, servicio/permisos, traslado completo, barriles implícitamente vacíos, compatibilidad de atributos y recibos anteriores.
- Selección integrada final: 129/129 en 20 archivos. Después se ejecutó la suite del host con casos nuevos de interrupción: 5/5; no se presenta como una nueva corrida integrada. Las pruebas adicionales del actualizador dieron 22 casos: 19 aprobados y 3 omitidos por plataforma; UI e inventario dieron 11/11.
- QA visual final: escritorio ES 1280×720 y touch EN 390×844; ambos recorridos terminaron sin errores de navegador, fallos HTTP ni solicitudes externas. Se inspeccionaron el manantial en el mundo, su marcador en el mapa completo y el barril 4/20 en móvil. El agua se conservó en depósito, retiro, vaciado en provisiones y recarga tras reload. El evidence bundle es [evidence-2026-10-11T04-35-22-891Z.json](rnv07-freshwater/local/evidence-2026-10-11T04-35-22-891Z.json); contiene 14 capturas, 7 por viewport.
- La fixture de navegador retiró enemigos y spawners para proteger el recorrido feliz. Por eso, la aceptación de encuentro/enemigos en navegador sigue pendiente. Las pruebas del host sí cubren interrupción por combate/daño; la fixture visual no demuestra esa aceptación.

## Siguiente corte

RNV07b: cantimplora reutilizable, rellenar/beber con supervivencia y aclarar consumo durante viaje activo. Después, el primer viaje Salty Shore–Puerto Sol; el purificador avanzado queda sujeto al acceso al componente de la tercera ciudad. No subir todavía su receta sin alternativa manual publicada y transición de patrimonio.
