# PRG01c — receta personal de Bodega

## Contrato

Con 60 puntos de Tala (o el hito válido de Tala) y la carpintería comunitaria completa de Salty Shore, la artesana del banco ofrece una enseñanza personal de la receta `raft_storage`. El hito por sí solo no concede la receta: hay que aprenderla allí. La enseñanza no coloca una pieza ni entrega materiales. En este corte requiere provisionalmente 2 maderas en la mochila; ese coste sigue siendo tuning, no una decisión confirmada por el autor. La activación permanece apagada.

La receta habilita colocar una Bodega nueva en una casilla libre de cubierta o piso. La construcción cuesta 6 maderas, debitadas primero de la bodega de la balsa y luego de la mochila, y añade 20 unidades de capacidad de carga. La masa de la balsa sigue bajo sus límites normales. La pieza inicial `crate` y las bodegas ya existentes siguen utilizables y se pueden retirar con las reglas actuales; el conocimiento solo bloquea nuevas colocaciones.

## Autoridad y persistencia

La enseñanza y las operaciones de construcción/retiro de Bodega usan la autoridad económica existente y su recibo durable: recibo confirmado antes de actualizar perfil y mundo o emitir el ACK. Cliente y panel esperan el ACK durable y la confirmación de perfil/snapshot actuales; una respuesta histórica no sustituye esa reconciliación.

La ruta durable exclusiva cubre la enseñanza y las operaciones de Bodega de este corte. El resto de las piezas del editor conserva su contrato legado de CAS; este brief no declara durable todo el editor, el perfil completo ni el juego.

El opt-in requiere la migración `021_artisan_operations.sql`, posterior a `001`–`020`, y `MN_ARTISAN_OPERATIONS=1`. El host solo acepta activarlo cuando Tala y la operación durable estén listas. El valor predeterminado es apagado. La verificación de SQL y la activación autenticada/live siguen pendientes.

## UI, ancla y reutilización

El panel tiene textos ES/EN según el `document.documentElement.lang` existente; no implementa ni publica un selector de idioma del sitio. La interacción reutiliza el banco procedural de carpintería de S19 y la ancla `snapshot.bench`; no añade modelo de NPC ni malla nueva. La Bodega reutiliza el render procedural de caja ya asociado al almacenamiento de balsa.

La revisión acotada de reutilización está en [D06-REUSE](../research/unreal-assets/D06-REUSE.md): el prop derivado `prop-storage-crate` ya está exportado e integrado, y `src/render/rafts.js` tiene la rama de caja. El antecedente visual del banco y su decisión sin arte nuevo están en [S19](visual-s19-town-furniture.md). No se importan Blueprints ni se reexporta el crate.

## Preparación de activación y canario

1. Aplicar y verificar `021_artisan_operations.sql` después de `001`–`020`; revisar prerrequisitos de Tala y disponibilidad durable. Mantener `MN_ARTISAN_OPERATIONS` apagado si falla cualquier preflight.
2. Con host/migración listos, habilitar el flag para un canario autenticado y aislado. Confirmar progreso de Tala e inventario de proyecto completo; consultar al banco y enseñar una sola vez con 2 maderas en mochila. Verificar recibo durable, nueva revisión/perfil y `raft_storage`.
3. Colocar una Bodega en una casilla válida con 6 maderas. Confirmar prioridad bodega→mochila, capacidad +20, revisión/snapshot, perfil y estado tras reinicio ordenado. Repetir la misma operación para probar replay sin segundo cobro ni segunda pieza.
4. Retirar la Bodega de prueba y verificar la transferencia de carga y el límite de capacidad resultante. Confirmar que la caja inicial y el almacenamiento anterior continúan disponibles. Desactivar el flag si el recibo, perfil, snapshot, replay o reinicio no coinciden.

El canario solo valida estas operaciones y la compatibilidad de este host/migración; no cierra la durabilidad global del editor ni de todos los perfiles. La integración pasó 114/114, la suite de release 107/107 y la revisión de paneles ES/EN 32/32; los conteos de pruebas se solapan. Una comprobación adicional de SQL021 pasó 5/5, incluido replay de un recibo anterior sin cambiar perfil, mundo o versiones. El código está enviado a la rama compartida; revisión activa, evidencia y límites de publicación están en la [entrega PRG01c](../delivery/prg01c-artisan.md). SQL021, la activación y el canario autenticado/live siguen pendientes.
