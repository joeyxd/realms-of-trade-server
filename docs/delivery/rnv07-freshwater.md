# RNV07a — cubeta, manantial y reserva naval

Primera publicación y activación en alpha.44 / protocolo 50, integrada con atributos SQL029 y SQL030. Runtime comprobado `80e46df8ca4664f93aa59df8350c27cc17589b53`, desplegado a las 04:47Z con imagen `sha256:b883545f9317c7ba3ed03e7e0ec5d27c62a997b3d0a8c717504980e3f338f353`.

**Integración posterior, 05:01Z:** alpha.45 / protocolo 51 con el editor de terreno concurrente; revisión activa `7a23f25be0bac3b9491681f0c78d12890eb73ea8`, imagen `sha256:c39f893e8080039e6b02263b40f74b66592147c3f81df1b85213c800a8f3e3f5`. El actualizador pasó 126/126 y se repitieron las seis comprobaciones públicas de cubeta, recibos y reconexión: [canario](rnv07-freshwater/public-alpha45/acceptance.json), [runtime](rnv07-freshwater/vps-alpha45.json). Agua y atributos siguen enabled/ready, health 200 y cero pendientes/errores. La cuenta temporal se eliminó; dos recibos se conservaron. El alcance sigue excluyendo recolección y traslado completos live. Los commits posteriores de documentación no cambian este código jugable.

## Circuito jugable

`U` en escritorio o **Agua / Water** en touch abre el panel. Fabricar una cubeta cuesta 2 tablas de la mochila; es reutilizable, lleva 4 unidades, ocupa 2 de volumen y pesa 1 más su contenido. También aparece en el inventario. El manantial está en UV (-69, 15), marcado en minimapa y mapa grande, junto al arquero existente. Recoger tarda 120 ticks (2 segundos activos) y se interrumpe por movimiento, daño, combate o salida de alcance. Vencer enemigos no genera agua ni desbloquea una fuente permanente.

El constructor ofrece **Barril de agua dulce**: cuesta 4 tablas, tiene 25 HP, pesa 2 vacío y admite 20 unidades. Empieza vacío; su contenido se guarda por identidad estable `pN`, separado de mercancías. Depositar o retirar requiere cubeta, propiedad, cercanía e integridad. No se puede desmontar lleno; la rotura conserva el contenido y reparar recupera acceso. Desmontar vacío usa el salvamento normal de hasta 2 tablas según condición. Solo se monta en balsa en este corte; las casas requieren construcción terrestre.

**Vaciar en provisiones** convierte contenido de cubeta en la mercancía existente `agua`, sin duplicarlo. No añade consumo ni cantimplora; esas acciones corresponden a RNV07b con supervivencia. Los costes y capacidades son tuning inicial ajustable. El purificador actual conserva su comportamiento durante la transición.

## Autoridad y compatibilidad

M5/GameHost sigue siendo el único dueño. Se usa la tabla `mn_economic_operations`, el namespace UUID, CAS de perfil/mundo, ACK después del recibo y recuperación de respuesta incierta. `hold.vessels` es un campo opcional estricto de hasta 32 recipientes; la ausencia histórica sigue significando vacío. La cubeta solo va en mochila; el barril solo se acepta con parte y condición coincidentes. Peso, volumen y límites navales incluyen el contenido una sola vez. Las demás familias económicas conservan los recipientes; el escritor base renombrado queda cerrado a `service_role`.

[SQL030](../../server/migrations/030_freshwater_operations.sql) fue aplicado por el autor después de SQL029 y conserva recibos históricos, atributos y permisos de servicio. `MN_FRESHWATER_OPERATIONS=1` está habilitado y readiness RPC vale 1; agua y atributos reportan enabled/ready. M5/GameHost sigue siendo la única autoridad y este corte no habilita suelo común, otro guardado ni otra sed.

## Arte y mapa

Se verificó el candidato concreto `C:\Unreal\MyProject\Content\_SplineVFX\Demo\Geometry\Meshes\Barrel.uasset` (40.964 bytes), pero no se aceptó por portabilidad. Se reutilizan las proporciones y geometría procedural del barril existente en el renderer de balsa y una poza sencilla de piedra y agua, sin editar Unreal ni el terreno. La fuente está centralizada en `src/data/freshwater.js`; un mapa nuevo debe declarar una fuente válida y su encuentro. La proyección de minimapa y mapa sigue compartida, sin depender de coordenadas CSS.

## Verificación local

- Host autenticado: cubeta pagada, recogida interrumpida y temporizada, replay exacto o cambiado, respuesta de commit perdida, ACK retenido, reconexión, barril pagado, depósito/retiro y retiro lleno denegado.
- SQL real en PGlite: migraciones 001–030, recibos/replay, falsificaciones, servicio/permisos, traslado completo, barriles implícitamente vacíos, compatibilidad de atributos y recibos anteriores.
- Selección integrada final: 129/129 en 20 archivos. Después se ejecutó la suite del host con casos nuevos de interrupción: 5/5; no se presenta como una nueva corrida integrada. Las pruebas adicionales del actualizador dieron 22 casos: 19 aprobados y 3 omitidos por plataforma; UI e inventario dieron 11/11.
- QA visual final: escritorio ES 1280×720 y touch EN 390×844; ambos recorridos terminaron sin errores de navegador, fallos HTTP ni solicitudes externas. Se inspeccionaron el manantial en el mundo, su marcador en el mapa completo y el barril 4/20 en móvil. El agua se conservó en depósito, retiro, vaciado en provisiones y recarga tras reload. El evidence bundle es [evidence-2026-10-11T04-35-22-891Z.json](rnv07-freshwater/local/evidence-2026-10-11T04-35-22-891Z.json); contiene 14 capturas, 7 por viewport.
- La fixture de navegador retiró enemigos y spawners para proteger el recorrido feliz. Por eso, la aceptación de encuentro/enemigos en navegador sigue pendiente. Las pruebas del host sí cubren interrupción por combate/daño; la fixture visual no demuestra esa aceptación.

## Publicación y activación

- El runtime público comprobado sirve alpha.44/protocolo 50 en la revisión `80e46df8ca4664f93aa59df8350c27cc17589b53`; la imagen es `sha256:b883545f9317c7ba3ed03e7e0ec5d27c62a997b3d0a8c717504980e3f338f353`, desplegada a las 04:47Z. El actualizador pasó 126/126. Una revisión posterior que solo añade este registro conserva el mismo código jugable.
- El bundle fijado a la imagen verificó 20/20 hashes Git y 22/22 pruebas en [image-water.tap](rnv07-freshwater/image-water.tap). La selección integrada previa fue 129/129; la nueva suite focalizada del host fue 5/5, no una repetición de la selección integrada.
- La lectura pública confirmó health 200 y siete hashes de fuente servida en [public-readonly.json](rnv07-freshwater/public-readonly.json). El canario público pasó sus seis comprobaciones, incluidas las operaciones WSS autenticadas y la denegación anónima, en [public/acceptance.json](rnv07-freshwater/public/acceptance.json): pago de cubeta de 2 tablas, replay exacto, colisión con comando cambiado, denegación de segunda cubeta, y persistencia/reconexión. La cuenta y el perfil temporales se eliminaron; se conservaron deliberadamente dos recibos económicos.
- [activation.json](rnv07-freshwater/activation.json) registra SQL030 y `MN_FRESHWATER_OPERATIONS=1`; [updater.json](rnv07-freshwater/updater.json) documenta el bundle incorporado. La comprobación de runtime y atributos listos está en el reporte de solo lectura.
- El WSS público no recorrió la recolección completa ni las transferencias del barril. Esas acciones y la persistencia visual completa se probaron en la fixture local sin enemigos; la aceptación live del encuentro y de una ruta completa sigue pendiente para RNV07b.

## Siguiente corte

Comprobación posterior de compatibilidad con la autoridad común, 05:06Z: el runtime `ea982f8e5326308aed6ba0ab9a6bee447ee22a59` pasó 127/127 del actualizador. La suite local de agua pasó 6/6, incluida la nueva guarda tras la lectura asíncrona del recibo. El [canario público repetido](rnv07-freshwater/public-common-alpha45/acceptance.json) pasó las mismas seis comprobaciones acotadas de cubeta y reconexión; [estado e imagen](rnv07-freshwater/vps-common-alpha45.json). Un intento previo se detuvo sin crear cuenta porque había otra conexión; se esperó a que quedara libre. No se montó ni activó el piloto público de suelo común. Esta verificación no amplía el alcance de recolección/transporte/encuentro live.

RNV07b: cantimplora reutilizable, rellenar/beber con supervivencia y aclarar consumo durante viaje activo. Después, el primer viaje Salty Shore–Puerto Sol; el purificador avanzado queda sujeto al acceso al componente de la tercera ciudad. No subir todavía su receta sin alternativa manual publicada y transición de patrimonio.
