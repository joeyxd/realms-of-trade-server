# SRV02 — comidas especiales

Implementado y probado localmente para alpha.58 / protocolo 57; enviado en `12c7339` a la rama del VPS. Código sobre `cd5df25`, conservando los cortes concurrentes. SQL035, activación y aceptación pública siguen pendientes; no hay activación automática. [Contrato](../../briefs/srv02-special-meals.md).

## Comportamiento

| Comida | Ingredientes provisionales | Efecto durante 15 minutos conectados |
| --- | --- | --- |
| Pescado asado | 1 pescado; fogata o parrilla propia encendida y cercana | +10 % vida máxima |
| Grog | 1 ron + 1 agua de provisiones | +25 % recuperación de aguante de combate |
| Galleta reforzada | 1 galleta + 1 harina; mismo requisito de fuego | +10 unidades de carga cómoda |

Solo hay un efecto activo; la siguiente comida lo reemplaza. Pausa offline, muerto y durante un commit retenido; desaparece al reaparecer. Cocinar consume y come al momento, incluso con necesidades llenas. No agrega mercancías. Mantiene la curación normal de comida una sola vez, las penalizaciones de hambre/sed, los límites de volumen/masa y los modelos de natación/navegación.

Perfil opcional exacto `meal:{v:1,kind,ticks}` (1–54000). Timers predichos en el snapshot, sincronizados con el perfil y el guardado M5 existente. `freshwater/meal` conserva los ocho campos y el recibo económico común. Replay no vuelve a gastar, curar ni renovar. Crear comidas está detrás de `MN_SPECIAL_MEAL_OPERATIONS`, default 0; exige cantimplora/agua y readiness SQL035. Deshabilitar nueva preparación conserva los efectos ya guardados si supervivencia permanece habilitada.

Panel ES/EN: tres recetas, coste, duración, aviso de reemplazo y motivo de bloqueo visible también en touch. Usa arte/UI/fuego existentes; no importa assets nuevos. La fogata/parrilla permanece en la balsa en este corte, sin introducir cocina de casas/tierra.

## Verificación

- [Regresión de simulación/host/UI](runtime-tests.log): 152/152; la prueba adicional de comercio MemoryStore con buff pasó dentro del grupo del actualizador.
- [Grupo del actualizador](updater-tests.log): 194/194, incluidos los nuevos casos de comidas; conteo solapado con la regresión.
- [SQL](sql-tests.log): 33/33 en cadena 001–035 PGlite, bajo rol `service_role`, validación estricta, recetas, ingredientes/necesidades/recipientes forjados, denegación sin cambio, replay y colisión, compatibilidad SQL030/032, migración repetida y recibo previo intacto. Incluye Tala cooperativa con comida en actor/colaborador y rechazo de editar el efecto del colaborador; el CHECK queda vinculado al validador nuevo.
- [Navegador local](local/evidence-2026-10-11T20-25-37-952Z.json): 6/6 ES/EN desktop, móvil y móvil rotado con `stage.js` real; DOM/estilos reales, cliente simulado. Scroll, requisitos visibles, temporizador, reintento idéntico y ausencia de mutación optimista. Sin errores JS/consola ni solicitudes externas. Capturas inspeccionadas por el integrador. No acredita una partida pública ni teléfono físico.

## Estado operativo y siguiente paso

INV02d ya estaba implementado: la corrección legacy está incluida en el VPS `cd5df25`, alpha.57. Lectura de este corte: un jugador/un socket, cero errores y pendientes; no se fuerza su relevo. Esta entrega agrega únicamente SRV02 sobre esa base.

[Lectura operativa a las 20:35Z](deployment.json): imagen activa `sha256:ea028cc249a3a6ee773479d1d7c314e04781ffeef779624e8b6ebce8f46b45cd`, alpha.57/cd5df25; salud pública 200. Se solicitó el actualizador normal y difirió el relevo por el jugador conectado. SQL035 todavía devuelve `PGRST202` (RPC ausente), así que no se activa el flag. El actualizador operativo quedó sincronizado con el grupo de 194 pruebas, hash comprobado y copia previa conservada; no se cambió el runtime ni la configuración del juego. **SRV02 no se declara desplegado o aceptado públicamente.**

1. Aplicar [SQL035](../../../server/migrations/035_special_meal_operations.sql) después de 001–034. Solo amplía funciones/validación; no reescribe perfiles ni recibos. El autor aplica SQL porque la sesión dispone de acceso de servicio, sin conexión administrativa SQL.
2. Verificar readiness 1 y conservar `MN_SPECIAL_MEAL_OPERATIONS=0` hasta el relevo normal a un runtime compatible. Actualizador con una autoridad y mundo idle/durable; nunca desconectar al jugador para esta entrega.
3. Activar el flag con la misma disciplina de relevo; verificar revisión, imagen, salud, fuentes públicas y flag. Hacer canario autenticado de consumo/replay/reentrada y separar los platos calientes (necesitan acceso real al fuego).
4. Playtest de duración/recetas y sensación de carga. Sigue INV03: bolsas y progresión de volumen, sin rehacer el sobrepeso existente.
