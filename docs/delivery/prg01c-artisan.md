# AREA03 PRG01c — artesano y bodega personal

Corte 2026-10-10, integrado con noche/faroles RNV03, borradores GM03a y diario M5 SQL019.
Runtime `0.6.0-alpha.29`, protocolo 41. [Contrato y activación](../briefs/prg01c-artisan-storage.md).

La carpintería comunitaria completa y el hito de Tala permiten aprender `raft_storage` en el banco
de Salty Shore. La lección consume dos maderas de la mochila, una vez; **ese precio es tuning inicial
provisional**, todavía sin respuesta del autor. Construir consume otras seis maderas, primero de la
balsa y después de la mochila. La bodega añade veinte unidades de volumen; mantiene los límites
normales de masa y construcción. La caja básica de dos maderas sigue siendo el escalón previo para
ampliar la pequeña capacidad inicial y poder reunir el material de la bodega.

Aprender, colocar y retirar **esta pieza** usan el mismo `EconomicAuthority`, perfil, mundo y recibo
M5. El recibo añade el perfil anterior exacto y valida el efecto sobre la fila bloqueada. Antes de
prepararlo se confirma el checkpoint vivo por el writer de mundo existente: la acción no cambia
mercados ni retrocede el acumulador económico. El host detiene el paso mientras espera el commit;
publica perfil, cubierta y ACK después de confirmar. Una respuesta perdida se consulta y se reproduce
por su identidad exacta; reproducir recibos históricos no reinstala perfiles anteriores.

La nueva colocación requiere conocimiento validado. Las bodegas existentes se pueden usar y retirar
sin aprender de nuevo. La retirada conserva la carga entre balsa/mochila dentro de sus capacidades;
el reembolso sigue el daño de la pieza, con identificadores y condición de las demás piezas intactos.
SQL prueba conservación y dirección de esa redistribución; el host determina el reparto exacto con
el helper existente. El resto del editor continúa por su contrato CAS anterior; este corte no lo
convierte en una transacción de construcción general.

La interfaz reutiliza el banco procedural S19 y la bodega procedural existente, sin nuevo NPC o asset.
La lección y los textos nuevos de bodega siguen `document.lang` ES/EN. Esto no añade un selector
global ni traduce las pantallas antiguas. La revisión cruzó [D06-REUSE](../research/unreal-assets/D06-REUSE.md)
y [S19](../briefs/visual-s19-town-furniture.md); no modificó las fuentes Unreal.

## Verificación local

- Integración final tras upstream y ajuste de foco: **114/114** en `integration.tap`, incluidos
  host/operaciones/editor, Tala/recursos, SQL021/económico, recuperación, GM y farol personal.
  El suplemento SQL021/recuperación pasó **8/8** y la suite de release **107/107**; se solapan
  con la integración y no se suman como casos distintos.
- Tres procesos con PGlite en disco: terminación antes de aprender, después de aprender y después de
  construir; al abrir otro proceso, perfil/versión/mundo/recibos exactos y replay sin duplicación.
  Es una caída local de proceso; no acredita corte eléctrico, disco restaurado o PostgreSQL live.
- Navegador con los paneles reales y fixtures explícitos: [evidencia](prg01c-artisan/ui/evidence.json),
  capturas ES/EN en escritorio, compacto y apaisado. No acredita dispositivo físico, balance o FPS.
- El SQL se aplica dos veces en la fixture y conserva recibos económicos anteriores. Se prueban
  acceso service-only, base de commit no invocable directamente, delta material/condición y forgeries.

## Publicación y activación

La publicación de código y la activación de la mecánica son pasos distintos. Estado del despliegue:
pendiente de verificar tras el push de este corte. **El artesano permanece apagado por defecto.**

Aplicar [SQL021](../../server/migrations/021_artisan_operations.sql) después de 001–020. SQL017–020
pertenecen a otros cortes; si la base solo llegó a 016, respetar esa cadena completa y no saltar
sus revisiones. El actualizador del VPS no aplica SQL ni cambia flags. SQL021 conserva los wrappers
y contratos presentes; no monta las operaciones de suelo de SQL018/019 ni activa agentes/GM.

Después de comprobar `mn_artisan_operations_ready()` como servicio, activar
`MN_ARTISAN_OPERATIONS=1` junto a los flags económico/recursos/Tala ya requeridos. Antes de aceptar
el flujo público faltan canario autenticado con requisitos reales, coste exacto, nueva bodega,
retirada con carga, reconexión/reinicio y replay. No se anuncian completadas la persistencia de
todas las mecánicas, el balance de progresión ni las siguientes profesiones.

El siguiente cierre de AREA03 es esa aceptación live; después se continúa con minería y la siguiente
especialización definida en el plan de skills, sin ampliar infraestructura antes de probar el ciclo jugable.
