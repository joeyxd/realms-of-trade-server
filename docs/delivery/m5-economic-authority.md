# Disponibilidad del alfa y autoridad económica M5

Corte del 2026-10-09, sobre la rama `claude/loving-lovelace-ptbif7`. Trabajo aislado de los cambios
concurrentes de agentes, arte y Web3. No se empaqueta el árbol dirty completo.

## Implementado

Comercio cotizado, compra de materiales desde el editor de la balsa, transferencias mochila/bodega
y aportes comunitarios usan una sola transacción
M5 de perfil, mundo y recibo inmutable. La identidad de cuenta procede de la sesión verificada.
La publicación espera confirmación y aplicación en el límite de tick. Duplicados, recibos históricos,
respuesta perdida, cierre y conflicto mantienen una sola autoridad de mutación.

La carpintería aparece desde el banco de materiales: requisitos, progreso, materiales propios,
cantidad, respuesta del servidor y reintento idéntico. Los metadatos de la obra sobreviven al autosave
y un escritor antiguo no puede omitirlos o alterarlos. Contrato y activación en el
[brief](../briefs/m5-economic-authority.md).

## Verificado localmente

- SQL014 en PostgreSQL/PGlite: commit conjunto, rollback, CAS, colisiones con el namespace M5,
  replay, denegación terminal, permisos, inmutabilidad y reaplicación.
- Host: ninguna mutación/confirmación previa al commit, bloqueo de tick y bypass ordinario,
  compra/venta/carga, conservación de materiales, límite restante, duplicado alterado, respuesta
  perdida, reconexión mediante una autoridad nueva, pausa, invitados, admisión durante operación,
  desconexión/cierre y bloqueo ante incertidumbre.
- UI: pruebas de contrato y QA de navegador en escritorio y móvil compacto. Cantidad superior a la
  mochila rechazada; solicitud superior al faltante limitada por el servidor; reintento tras cinco
  segundos conserva el comando y la UI no sustituye el perfil por datos de recibos.
- Regresiones de cuentas, guardado de perfiles/mundo, balsa, herramientas, servidor y supervisor.

Las capturas inspeccionadas del panel se generan con `tools/qa-community-panel.mjs` en
`.scratch/community-panel/`. También se verifican dos procesos independientes contra PGlite en disco:
terminación antes del commit y después del commit, seguida de recuperación sin segundo débito.
Esto no acredita pérdida de energía, de disco ni una caída abrupta del VPS.

## Disponibilidad pública

La incidencia anterior quedó recuperada: la sonda del 2026-10-10 04:22 UTC admitió cuatro invitados,
recibió snapshots durante 30 segundos y terminó sin errores ni desconexiones inesperadas. Salud
pública HTTP 200, Supabase durable y mundo preparado. Evidencia saneada:
[availability.json](m5-economic-authority/availability.json).

Después de activar M5 y del reinicio de aceptación, la sonda del 2026-10-10 05:32 UTC volvió a admitir
cuatro clientes durante 30 segundos: 6,912 entradas, 2,441 snapshots posteriores a la admisión,
cero errores y cero desconexiones inesperadas. El p95 de `stepMs` fue 2.877 ms, medido sobre muestras
por segundo del host; no es una medida de FPS de teléfono. Evidencia:
[availability-m5.json](m5-economic-authority/availability-m5.json).

La recuperación operativa y el actualizador revisado están descritos en
[vps-updates](vps-updates.md). Un contenedor vivo por sí solo no acredita disponibilidad; se comprueban
imagen/revisión, salud pública y entrada real. Las activaciones SQL/env se verifican por separado.

## Publicación y aceptación M5

SQL014 se aplicó en el Supabase configurado; el editor confirmó éxito y el RPC de lectura ya responde.
Se verificaron RLS, ejecución/lectura de servicio y denegación de ejecución/escritura directa al
cliente. Evidencia saneada: [sql-live.json](m5-economic-authority/sql-live.json).
La autoridad económica está activada en el mismo VPS público, versión `0.6.0-alpha.17`, protocolo 32.
El recorrido con cuenta real pasó por los controles normales: recoger troncos, fabricar madera,
aportar una unidad, vender cinco unidades cotizadas, comprar una fruta, depositar una madera en
la bodega, comprar otra desde el editor de balsa y retirar la depositada. Perfil, mundo y diez
recibos se verificaron en Supabase. La reconexión restauró oro, materiales, bodega y obra;
los diez reintentos idénticos conservaron el perfil y el progreso actuales.

El 2026-10-10 05:30 UTC se reinició realmente el contenedor `d24f782` tras comprobar cero jugadores,
cero sockets y guardados drenados, bajo el mismo bloqueo del actualizador. El arranque recuperó
el perfil versión 23, la balsa revisión 4 y la obra versión 4. Evidencia:
[controlled-restart.json](m5-economic-authority/controlled-restart.json) y
[live-acceptance.json](m5-economic-authority/live-acceptance.json). Los diez reintentos después
del reinicio también pasaron, sin segundo débito, nueva carga ni retroceso del mundo. En total se
contrastaron diez operaciones y veinte replays públicos, diez tras reconexión y diez tras reinicio.

La sonda usa una cuenta desechable y rutas calculadas sobre el mapa, con entradas normales; no
inyecta oro, materiales, capacidad ni posición. Se corrigieron supuestos del arnés sobre capacidad
de mochila, revisiones de nodos, obstáculos y stock fraccionario/autónomo. Sus intentos parciales
quedan diferenciados de los checkpoints completos. La limpieza elimina solo la cuenta/perfil de
prueba y conserva los aportes legítimos al mundo y sus recibos de auditoría.

No se afirma persistencia de cada acción, crecimiento automático de edificios, ocho conexiones,
coordinadores de perlas activos ni tolerancia a pérdida de disco. La pausa global durante el RPC es
una limitación deliberada de esta primera alfa pequeña.
