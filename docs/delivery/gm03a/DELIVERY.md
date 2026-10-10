# GM03a — borradores remotos privados

Estado al 2026-10-10: **migración GM `020_gm_drafts.sql` aplicada y readiness live `version: 1`; runtime todavía no publicado**.
Este corte prepara continuidad del borrador GM entre navegadores para la misma cuenta y mundo. No publica
ni activa mapas, no cambia el puntero del mundo y no modifica gameplay o la autoridad M5.
[Brief](../../briefs/gm03a-remote-drafts.md) · [Plan GM](../../../PLAN-GM-EDITOR.md).

## Alcance implementado

El almacenamiento separa las cabezas privadas de borrador de `mn_worlds`, perfiles y recibos económicos.
La identidad y el mundo se resuelven en el servidor; cada operación de guardado usa revisión esperada
(CAS) y UUID. Los recibos conservan la respuesta original para reintentar una operación exacta tras una
respuesta perdida; reutilizar su UUID con otro contenido se rechaza. Los permisos son de servicio, con
RLS habilitada y sin acceso directo de `anon` o `authenticated`. El proveedor de memoria se identifica
como no durable y queda limitado a pruebas.

La migración GM `020_gm_drafts.sql` aplicada incluye las tablas y RPC de borradores/operaciones, validación básica de documento v2,
recibos inmutables y una readiness que comprueba RLS, ACL, esquema, claves primarias y trigger de recibos.
La readiness live reportó `version: 1` a `2026-10-10T20:41:47Z`. Hash SHA256 reportado para la migración
aplicada: `601d45004c2daba734f92ada44a6300d741b490eeea14ea2d5e69f5babdbc9e4`.

## Verificación disponible

- Pruebas locales enfocadas store/SQL: **6/6 aprobadas**. Incluyen reaplicación de migración, CAS concurrente,
  replay exacto, UUID reutilizado, permisos/RLS, recibo inmutable, readiness con trigger deshabilitado,
  validación de documento y reapertura tras commit con respuesta perdida.
- Evidencia live: aplicación de migración GM `020_gm_drafts.sql` y readiness versión 1, con hora/hash indicados arriba.
- Aún sin evidencia: runtime publicado, canario de guardado remoto en el servicio activo, aceptación browser
  con la cuenta GM y verificación pública autenticada. La UI y la continuidad end-to-end no se declaran
  aceptadas hasta completar esas pruebas.

## Siguientes gates

1. Publicar el runtime que integra store y endpoints, preservando rama/artefactos existentes.
2. Verificar imagen/revisión activa, salud y entrada real antes de ejecutar un canario aislado de guardado,
   lectura, CAS y replay autenticados; no usar ni sobrescribir el borrador real del autor.
3. Aceptar en navegador la adopción explícita de un borrador entre contextos, conflicto sin pérdida,
   exportación/recuperación, logout y errores de red.
4. Mantener **GM03b pendiente**: preparar/publicar revisión, puntero activo bajo autoridad M5,
   exclusión con actualizador, validación de mundo y rollback. Ningún resultado de GM03a implica que un mapa
   ya esté publicado o activo.

Se reutilizan editor GM02, catálogo/derivados GM00, exportación JSON y assets existentes; no se añadió arte.
La captura `SM_StoragePart_03` / `prop:storage-crate` del brief es una referencia de reutilización visual,
no otorga autoridad de contenedor ni requiere una reexportación para GM03a.