# GM03a — borradores remotos privados

Corte 2026-10-10, alpha.28; QA local GM / protocolo 39 y runtime integrado / protocolo 40 (RNV03 upstream).
**Publicado y aceptado con Supabase real** en `9f23be3`.
[Brief](../../briefs/gm03a-remote-drafts.md) · [Plan GM](../../../PLAN-GM-EDITOR.md).

## Uso

Desde **Editor del mundo → Online**, **Guardar online** presenta una revisión antes de sustituir el
borrador remoto. **Cargar online** trae la copia de la misma cuenta y mundo; el diseño anterior queda en
Deshacer hasta cerrar el editor. El guardado local sigue siendo automático y ambos diseños se pueden
exportar por separado. Un conflicto conserva el diseño local y exige actualizar/revisar antes de guardar.
Si una respuesta se pierde, **Resolver guardado pendiente** reenvía el intento original, incluso después
de recargar o cerrar sesión. No sustituye las ediciones locales posteriores.

## Contrato y autoridad

Un head privado por cuenta GM/mundo, revisión CAS y UUID de operación. Head y recibo se escriben juntos;
replay devuelve el resultado original y reutilizar el UUID con otra petición se rechaza. Los conflictos
también dejan recibo terminal. El intento exacto se persiste en IndexedDB antes de enviar; cuota o
recuperación no disponible impiden el envío. No se guardan credenciales en el documento ni en el intento.

GET/PUT `/api/gm/draft` resuelven identidad Supabase y allowlist GM en cada petición. El servidor deriva
mundo/semilla/base y valida documento v2, IDs reales del catálogo/base, límites y transformaciones.
JSON acotado a 5 MiB, tiempos de espera y rate limit; respuestas privadas no cacheables. La UI distingue
confirmación durable de Memory temporal. Si falta la migración/readiness, el juego arranca y la edición
local sigue disponible. Una base antigua conserva exportación; una base runtime incompatible bloquea
la carga y el reemplazo.

SQL020 crea `mn_gm_drafts` y `mn_gm_draft_operations`, separados de `mn_worlds`, perfiles y recibos M5.
RLS y permisos solo de servicio; tablas sin DML directo del servicio, RPC dedicadas y recibos inmutables.
Readiness verifica esquema, claves, RLS, ACL y trigger. Los recibos se conservan para recuperación;
no hay todavía navegador de historial ni política de retención operativa.

No se activa contenido del mundo compartido ni se escribe gameplay. No se cambian flags M5, agentes,
Web3 o contraseña GM. GM03a no añade campos al protocolo; integra el protocolo 40 de RNV03.
GM03b preparará publicación, puntero activo bajo M5, exclusión con el actualizador y rollback.
Terreno, prefabs, multiedición y colliders transitables siguen fuera. Se reutilizan GM02, derivados GM00
y arte existente; ninguna textura/modelo nuevo ni fuente modificada.

## Pruebas locales

- [Regresión servidor](server-regression.json): **113/113**, HTTP/store/SQL/autenticación, economía,
  recursos y rafts. [TAP](server-regression.tap). Incluye mapas/perfiles/mundo intactos y readiness fallida
  con `/health` sano/API 503.
- [Integración GM + diario M5](integrated-tests.json): **102/102**, con suites solapadas con la anterior.
  [Salida](integrated-tests.log). SQL020 se reaplica después de SQL019 M5 sin colisión.
- [Navegador local](browser-evidence.json): **35/35**, autenticación fixture y Memory explícitamente
  temporal; dos contextos con IndexedDB aislado, adopción/Undo, conflicto, commit con respuesta perdida,
  recarga/retry exacto, logout en vuelo, exportación de base antigua y bloqueo de runtime incompatible.
  También conserva GM01/GM02, gizmos en cuatro calidades y entrada normal al juego.
- Capturas ES/EN inspeccionadas: [ES](gm03-online-es.png), [EN](gm03-online-en.png).
  [Correcciones del harness y límites](validation-history.json). No acredita FPS de teléfono físico.

## SQL live

[Migración aplicada](migration.json): transacción autenticada completada en Supabase SQL Editor;
readiness `version:1` a `2026-10-10T20:41:47.482Z`, SHA256
`601d45004c2daba734f92ada44a6300d741b490eeea14ea2d5e69f5babdbc9e4`.
Se renumeró de 019 a 020 conservando bytes al integrar el diario M5 que ocupó 019.
Este corte no aplica SQL019 M5 ni activa sus coordinadores.

## Publicación y aceptación real

[Revisión/imagen/status](deployment-evidence.json): runtime `9f23be355107ce0fdb783a5f68fd9cc93289cbda`,
alpha.28/protocolo 40, una instancia sana y timer activo, **107/107** del actualizador.
Integra GM03a y RNV03 upstream; GM03a no añade campos de gameplay/protocolo.

[Canario SQL](sql-live.json): **14/14**, readiness, ACL anon/authenticated, CAS concurrente de un único
writer, replay de éxito/conflicto, rechazo de UUID reutilizado y commit con respuesta perdida seguido de
retry exacto sin segunda revisión. Solo usa RPC de contenido GM. [Registro QA retenido](qa-records.json):
dos scopes sintéticos, dos heads y seis recibos; no se crearon cuentas Auth ni filas M5. La primera sonda
se corrigió por esperar la clase de error M5 en vez de `GmDraftStoreError`; el commit había sido correcto.

[Navegador público](public-evidence.json): **17/17**, Supabase real, invitado denegado, juego público,
cuenta GM en calidad alta, guardado durable explícito, segundo contexto con IndexedDB independiente,
carga/Undo, conflicto sin pérdida, logout y regresión GM02 sin errores. Se restauró mediante CAS la copia
remota anterior: segundo recorrido r3→r6 con documento intacto; el primer recorrido encontró ausencia y
la devolvió a un documento vacío compatible r3. No se tocó la contraseña. Capturas reales inspeccionadas:
[ES](production-gm03a-online-es.png), [EN](production-gm03a-online-en.png).

[Primera prueba pública](public-first-attempt.json) ya aprobó todos los casos GM03a y restauró la copia;
falló después al observar la cámara tras la animación del menú. El harness ahora captura la restauración
sincrónica en `walkPreview.stop`; repetición completa 17/17. Ningún cambio de runtime fue necesario.

El checkpoint posterior y la igualdad de fuentes runtime al publicar documentación se registran en
[status final](post-qa-status.json): `3319634`, sano y con fuentes runtime idénticas a `9f23be3`.
La [lectura posterior al relevo de proceso](post-restart-read.json) conservó r6 y el documento vacío
restaurado, sin escrituras nuevas. Sigue **GM03b**: publicación/activación/rollback de mapas con M5.
