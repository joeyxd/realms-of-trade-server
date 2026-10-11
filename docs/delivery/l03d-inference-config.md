# L03d-e1 — Configuración privada del centro de inferencia

Implementación inicial alpha.41; integración final alpha.42/protocolo 48, conservando GM04b.
[Contrato](../briefs/l03d-inference-config.md).
El autor eligió preparar la configuración y decidir proveedor/importe después; ofreció un modelo
local para el siguiente adaptador. Este corte no llama proveedores ni aplica un presupuesto de gasto.

El centro ingame permite preparar un límite de cuenta, un límite por conexión y una selección
conexión/modelo por compañero existente. Dos compañeros que usan la misma conexión comparten su
único límite. No hay importe ni modelo preseleccionado. Los techos son anidados; el futuro ledger
debe reservar contra cuenta y conexión a la vez. No representan saldo, uso ni reservas actuales.

La sesión admitida determina cuenta y mundo. Catálogo y personajes se filtran por dueño; no se
aceptan URL o credenciales en este DTO. Guardar exige compañeros detenidos y nunca los reanuda.
SQL028 conserva una revisión CAS por mundo/cuenta, con replay exacto inmediato. Tabla privada RLS,
sin acceso directo de service_role; sólo RPC acotadas. Perfil, mundo y recibos económicos no cambian.

La UI ES/EN conserva el borrador ante conflicto o escritura incierta, incluso al cerrar/reabrir.
La recarga explícita adopta el head confirmado; salir de sesión elimina la proyección privada.
Una operación que supera el timeout mantiene su slot hasta terminar; no entrega ACK a otra sesión.

## Validación

- Integración local: 52/52 en ocho archivos; protocolo/host, SQL028/store, cliente/UI y regresión de
  control/configuración. Casos de aislamiento, stop, catálogo revocado, CAS/replay y respuesta tardía.
- SQL028 aplicado en Supabase; readiness versión 1. Canario como service_role: save, replay exacto,
  conflicto e aislamiento; rollback comprobado con head revisión cero. Sin filas de prueba retenidas.
- Regresión adicional: 54/54 en nueve archivos, incluidos SQL025/027, ficha/control y red de la mente.
- [Navegador inicial alpha.41](l03d-inference-config/browser.json): 11 comprobaciones, seis capturas.
- [Integración final alpha.42](l03d-inference-config/integration-final.json): 70/70 en doce archivos;
  incluye los 52 casos originales y cuatro archivos de plantillas GM04b.
- [Navegador final alpha.42](l03d-inference-config/final-alpha42/browser.json): 12 comprobaciones,
  seis capturas revisadas
  por root. Chrome PC ES/EN, portrait poblado 390×844 y paisaje 844×390 ES; nueve controles alcanzables
  por scroll y objetivos de al menos 44 px. Autenticación simulada, gameplay/control en memoria;
  SQL028 en disco reabierto en revisión 2. Cero errores de página, consola o solicitudes.
- [Integración tras los últimos merges](l03d-inference-config/integration-merged.json): 97/97 en
  17 archivos; incluye los 70 anteriores, la frontera común de suelo y Carga todavía sin montar.
  Los 39 hashes aceptados del centro/GM04b no cambiaron. Conteos solapados.
- [Navegador con el HUD integrado](l03d-inference-config/final-hud-integration/browser.json):
  12/12 y seis capturas; root revisó PC EN, móvil vertical poblado y paisaje ES. Sin errores;
  conserva el alcance local con autenticación simulada y SQL028 en disco.
- Publicación pendiente; el último runtime previo comprobado es `a7f9e6d`/alpha.40.

Evidencia SQL en [sql-live.json](l03d-inference-config/sql-live.json). Los conteos de selecciones
locales se solapan; no deben sumarse como cobertura independiente.

## Próximo corte

Ledger central de reservas y uso incierto, endpoint/modelo local y límites elegidos; después conectar
personalidad/metas y memoria basada en eventos confirmados. Guardado público de un dueño real,
proveedor operativo y canario de memoria tienen aceptación propia. El catálogo del VPS queda vacío.
