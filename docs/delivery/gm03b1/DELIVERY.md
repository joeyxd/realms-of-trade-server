# GM03b1 — revisión preparada para publicación

Fecha: 2026-10-10. Estado: **implementado y probado localmente en alpha.30 / protocolo 41**;
publicación de código y aceptación pública en curso. [Contrato previo](../../briefs/gm03b1-prepared-revision.md).
No se ha activado un mapa nuevo. GM03b2 conserva publicación durable, activación y rollback como siguiente entrega.

Desde **Editor del mundo → Online → Validar para publicar**, el GM prepara la revisión online que está
viendo. Si hay errores, el informe permite enfocar cada objeto. Al corregir y guardar online puede
descargar un JSON con documento, revisión origen, hashes de dependencias, base, runtime y colisiones.
La descarga contiene metadatos; los modelos siguen en los assets distribuidos. El paquete tiene un
ID SHA-256 reproducible; no es un permiso de activación ni una revisión guardada en un registro remoto.

El servidor deriva cuenta/mundo y lee exclusivamente el head privado confirmado. Exige la revisión
esperada antes y después de preparar; una escritura concurrente devuelve conflicto. El endpoint no
guarda perfiles, economía, mundos ni borradores. Se mantiene GM03a y su recuperación exacta de PUT.
Un fallo de preparación no desactiva el guardado online ni el juego. No hay SQL, flags o protocolo nuevos.

La proyección de círculos es compartida con Probar caminando. Recursos, props base y RNG permanecen
intactos. El preflight comprueba límites de edición/escala/radio/dominio/altura, accesos protegidos y
camino principal. No certifica transitabilidad completa, espacios entre todos los edificios, volumen
visual de modelos sin proxy, posiciones de posesiones persistentes ni rendimiento físico. Esos límites
deben resolverse antes de ofrecer activación. Los candidatos GM00 conservan su advertencia de arte.

Los modelos añadidos y **todos los assets del manifiesto base** fijan sus bytes reales, incluyendo
texturas móviles. Se valida GLB autocontenido y rutas dentro de assets, también mediante realpath.
La huella de runtime fija src, import map, versiones y compilador; hashes de props/colisiones/recursos
fijan la base generada. No se sobrescriben originales ni se vuelve a comprimir una descarga 2K/4K.

## Comprobaciones locales

- [Regresión](regression.json): **183/183**, sin omisiones ni fallos; GM00–03, assets, proyección,
  preparación/HTTP/cliente, SQL020, cuentas, economía, recursos y barcos. [Salida TAP](regression.tap).
- [Navegador](browser-evidence.json): **41/41**, autenticación simulada y Memory señalado temporal.
  Conserva gizmos en cuatro calidades, edición base, caminar, recuperación, dos contextos y revocación;
  añade errores de spawn/enfoque, descarga verificada, repetición determinista, invalidación al editar,
  conflicto remoto y restauración CAS del baseline. ES/EN y capturas inspeccionadas.
- El [primer intento](browser-first-attempt.json) alcanzó los cinco checks nuevos y agotó la cuota
  compartida de peticiones al restaurar tras la suite anterior. Se corrigió el harness para comenzar
  una ventana nueva de cuota; no se aumentó el límite del producto. La ejecución completa pasó después.
- Tras esa ejecución se amplió la fijación de dependencias a todos los assets base y se aclaró el texto
  de la UI. La regresión 183/183 cubre esa ampliación; el navegador público comprobará el runtime final.

## Continuación

GM03b2 debe registrar revisiones inmutables y dependencias retenidas, validar el mapa contra posiciones
persistentes, montar la proyección al arrancar la única autoridad y exigir la misma revisión en admisión.
Activar/rollback requiere mundo vacío y exclusión compartida con el actualizador; conservar perfiles,
economía, recursos y progreso. Este paquete preparado no evita ninguna de esas comprobaciones.
