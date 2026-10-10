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

La recuperación operativa y el actualizador revisado están descritos en
[vps-updates](vps-updates.md). Un contenedor vivo por sí solo no acredita disponibilidad; se comprueban
imagen/revisión, salud pública y entrada real. Las activaciones SQL/env se verifican por separado.

## SQL aplicada; publicación y aceptación en curso

SQL014 se aplicó en el Supabase configurado; el editor confirmó éxito y el RPC de lectura ya responde.
Se verificaron RLS, ejecución/lectura de servicio y denegación de ejecución/escritura directa al
cliente. Evidencia saneada: [sql-live.json](m5-economic-authority/sql-live.json).
La publicación y el nuevo recorrido público con cuenta, comercio/aporte y reinicio siguen pendientes
en este checkpoint. No se declara ese recorrido probado hasta registrar sus resultados.

No se afirma persistencia de cada acción, crecimiento automático de edificios, ocho conexiones,
coordinadores de perlas activos ni tolerancia a pérdida de disco. La pausa global durante el RPC es
una limitación deliberada de esta primera alfa pequeña.
