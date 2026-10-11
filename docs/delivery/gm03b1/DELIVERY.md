# GM03b1 — revisión preparada para publicación

Fecha: 2026-10-10. Estado: **código desplegado y flujo público verificado en alpha.30 / protocolo 41**.
[Contrato previo](../../briefs/gm03b1-prepared-revision.md).
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
  de la UI. La regresión 183/183 y el navegador público siguiente comprueban el runtime final.

## Publicación y aceptación real

[Despliegue](deployment-evidence.json): release `6e6f42192bc1cc8cc564d870471d18dcdee9ac66`, imagen
`marea-negra:alpha-6e6f42192bc1`, contenedor sano y único, `/health` 200, Supabase durable/cuentas
sin errores ni escrituras pendientes. Actualizador: **107/107**. No se cambió ninguna activación M5.

[Navegador público](public-evidence.json): **23/23**, Supabase real, calidad alta, sin errores.
Incluye entrada de invitado al juego y rechazo GM, autorización real, gizmos, edición base y recorrido
privado, guardado/adopción/conflicto entre dos contextos, revocación y los seis checks de preparación.
El paquete válido registra **57 dependencias base**, incluidas variantes móviles. Además de verificar
el ID del JSON se compararon tamaño y SHA-256 de tres archivos servidos: caja añadida, roca costera
y variante móvil. La repetición produce el mismo ID; editar invalida el resultado y preparar una
revisión remota antigua devuelve conflicto sin perder el diseño local.

La prueba GM03a restauró mediante CAS el documento previo r6→r9; la preparación restauró el mismo
documento r9→r13. Props/colisiones del mapa activo y diseño local se conservaron. No se cambió la
contraseña. [Ejemplo preparado de QA](prepared-example.json), solo metadatos y hashes; no es contenido
activado ni un paquete de modelos retenidos. Capturas reales ES/EN inspeccionadas:
[errores reparables](production-gm03b1-problems-es.png), [preparada ES](production-gm03b1-prepared-es.png),
[preparada EN](production-gm03b1-prepared-en.png).

[Estado posterior a QA](post-qa-status.json): misma revisión e imagen, cero jugadores/sockets,
almacenamiento sano, sin escrituras pendientes ni tick bloqueado.

## Continuación

GM03b2 debe registrar revisiones inmutables y dependencias retenidas, validar el mapa contra posiciones
persistentes, montar la proyección al arrancar la única autoridad y exigir la misma revisión en admisión.
Activar/rollback requiere mundo vacío y exclusión compartida con el actualizador; conservar perfiles,
economía, recursos y progreso. Este paquete preparado no evita ninguna de esas comprobaciones.
