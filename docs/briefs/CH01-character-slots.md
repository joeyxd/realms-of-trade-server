# CH01 — personajes guardados independientes

El autor confirmó el 2026-10-12 que cada personaje debe tener su propio guardado permanente. Elegir el aspecto Bucanero actualmente reutiliza el perfil de la cuenta y por eso conserva las espadas del personaje anterior.

## Corte acordado

- Tres slots por cuenta, con selección explícita entre continuar y crear. Cada personaje conserva inventario, equipo, poderes, economía, misiones y progreso; un Bucanero nuevo comienza con pistolas.
- El perfil histórico conserva su UUID, JSON, versiones, recibos y propiedad de objetos únicos. Se registra como primer slot, sin clonarlo ni reiniciarlo. Como antes no persistíamos nombre/aspecto, la recuperación pide confirmarlos una vez.
- La cuenta autenticada es el propietario del roster; el UUID del personaje es la clave del perfil y de sus operaciones económicas. Permisos GM, wallet y administración de compañeros siguen perteneciendo a la cuenta. Compañeros y pilotos IA conservan sus rutas existentes.
- Una sola sesión humana por cuenta, incluida la escritura final pendiente. El servidor valida la propiedad del personaje antes de cargarlo. Crear es atómico e idempotente y no permite sobrepasar los slots ni apropiarse de UUID ajenos.
- El invitado también tiene slots separados por navegador y servidor, conservando intacto el blob anterior. Estos guardados locales se distinguen de los permanentes de cuenta. La importación firmada sigue siendo explícita, una sola vez y solo para una cuenta sin personajes.
- Recordar el último seleccionado y mostrarlo al regresar. No hay eliminación, clonación ni transferencias entre slots en este corte.

## Integración y aceptación

La migración SQL038 añade el roster, sus RPC de servicio y un guard de INSERT en perfiles que impide que clientes anteriores creen un perfil fantasma de cuenta después de abrir slots independientes. Las filas y contratos M5 existentes no cambian. El endpoint autenticado falla cerrado si el roster durable no está preparado; ningún fallo de auth/SQL se convierte en invitado. La selección viaja en HELLO y el servidor impone nombre/aspecto guardados. Revisar protocolo y publicación por separado de la instalación SQL.

Probar conservación exacta del perfil histórico; dos perfiles con estados distintos; Bucanero nuevo con pistolas; reentrada y selección recordada; acceso entre cuentas rechazado; creación/reintentos concurrentes; sesión ocupada hasta finalizar guardado; importación única; invitados por servidor/cuenta; continuidad de operaciones M5 y administración de compañeros. Inspeccionar pantalla de slots en escritorio y móvil.

Reutilización visual: retratos, colores, tipografía y modelos ya integrados (incluido el Bucanero). El inventario Unreal/FAB no aporta una autoridad de persistencia ni un componente web reutilizable para este flujo; no se crea ni modifica arte fuente.

Implementado y validado localmente el 2026-10-12: almacenamiento, servicio autenticado, selección autoritativa, aislamiento de perfiles y selector ES/EN. SQL038 pasa 5/5 y memoria 5/5. Recorrido real de invitado: perfil anterior con 77 monedas, Bucanero nuevo con pistolas y cero monedas, regreso al anterior con 77; blob original intacto y capturas de escritorio/móvil inspeccionadas. La instalación SQL en Supabase y la publicación alpha siguen pendientes; no hay acceso SQL desde esta sesión.
