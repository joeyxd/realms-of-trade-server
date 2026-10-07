# D08c.1 — cuerpo naval en el tick del servidor

2026-10-06. Continuación autorizada por el autor después de D08c.0. Este corte conecta el cuerpo a
`World.stepWorld()` como ensayo interno; el siguiente corte une puesto de mando, piloto y cubierta móvil.
El playtest humano conjunto queda para después de estructura/features, sin sustituir las comprobaciones técnicas.

## Contrato

- `new World(seed, { server: true, navalTrial: true })` habilita `NavalTrial`; por defecto es `null`.
  LocalServer/host/cliente no habilitan la opción ni reciben nuevas órdenes navales públicas.
- `start(owner, shipId)` recibe la entidad que un llamador interno resuelve desde su sesión de servidor.
  Solo admite un jugador vivo, conectado, no bot y dueño del barco activo, con el perfil/barco actuales.
  Clona un plano válido, asigna IDs `trial:<instancia>:p<pieza>` una vez y usa carga vacía y viento constante.
  Los IDs son efímeros; no son identidad durable de módulos ni un barco nuevo en inventario.
- El ensayo conserva un cuerpo separado: estructura/HP, rig, pose del origen y estado del centro de masa.
  El origen inicial coincide con el amarre existente, incluida su altura; la bodega real no aporta lastre.
- El handle de control es una identidad opaca de objeto, exclusiva de ese ensayo/World. Una copia JSON,
  un ID de barco o el campo owner de un paquete no conceden control. No hay puesto de timón físico todavía.
- `input(handle, { seq, throttle, brake, steer })` valida exactamente esos cuatro campos, valores finitos
  y rangos; rechaza secuencias repetidas/antiguas. Varias entradas en un tick conservan los últimos ejes.
  `ack` avanza al aplicar en tick, no al recibir. Son ejes mantenidos, no una cola de acciones discretas.
- Cada tick del World avanza una vez a 60 Hz. Pasados 15 ticks sin entrada válida, pone timón/acelerador
  neutros y freno; conserva el último número de secuencia para impedir que un paquete viejo reactive el empuje.
  Una entrada nueva puede reanudar. Son constantes de ensayo en `src/data/navalTrial.js`, no balance final.
  El controlador prepara todos los cuerpos/ACK antes de confirmar el tick: si un cálculo falla, conserva
  cuerpos, golpes pendientes y acuses para detener el ensayo inválido y reintentar sin aplicar daño dos veces.
  Esta preparación ocurre al inicio de `stepWorld`, antes de chills, tinta y bots: un fallo naval tampoco
  consume movimiento ni RNG de esos sistemas. No convierte el resto del World en una transacción reversible.
- Se revalidan perfil, sesión, dueño, entidad de nave, registro, revisión, plano y pose del amarre antes de
  usar el cuerpo. Un cambio de identidad o edición in-place invalida el ensayo. `detachRafts` lo retira
  inmediatamente; un índice ECS reciclado y un nuevo ensayo nunca recuperan un handle anterior.
- Daño interno en cola, acotado, aplicado en tick: HP/IDs se conservan, rig se recalcula y el cambio de COM
  no desplaza el origen del barco. Sin flotación, el ensayo queda inmóvil e inutilizado. No hay reparación,
  reembolso, retirada de bienes ni escritura de HP/pose del ensayo en perfiles.
- Límites: 32 cuerpos, uno por dueño/barco; 32 golpes pendientes por cuerpo. `close` invalida todo y cierra
  permanentemente ese controlador. El paso exige ticks consecutivos y no consulta reloj/FPS/RNG externo.
  El llamador del World de ensayo es dueño de `close`; LocalServer no expone el opt-in. Antes de activarlo
  en host, integrar su cierre. La validación de planos de hasta 600 piezas por tick aún requiere medición
  antes de ampliar a navegación pública; el límite técnico no demuestra rendimiento móvil ni de servidor.

## Por qué la pose pública permanece amarrada

Mover solo el barco dejaría al jugador y las consultas de suelo en estados distintos. En este paso, el
cuerpo se mueve dentro del World pero la entidad ECS original, `publicRafts` y `RaftDeck` conservan el
amarre. Es una conexión real del motor al tick autoritativo, todavía sin navegación visible/jugable.
La activación del próximo corte debe mover nave, cuerpo del piloto y soporte juntos, con ACK/predicción.
No usar este ensayo para entrar al mar, comerciar, construir en movimiento o exponer bienes.

## Reutilización Unreal/FAB

Revisión acotada del inventario [D08](../research/unreal-assets/D08-REUSE.md) y existencia verificada:

| Candidato | Archivo fuente / bytes | Decisión |
|---|---|---|
| Interfaz de movimiento | `C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\Blueprints\Interfaces\BPI_PlayerMovement.uasset` · 12.258 B | No se verificó lógica naval; no aporta autoridad Node ni identidad de sesión portable |
| Input Unreal | `C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\Input\Actions\IA_Move.uasset` · 1.590 B | Enhanced Input no ejecuta aquí; conservar el contrato de entrada propio |

Reutilizados: dinámica, estructura/HP, rebase, plano/propiedad y tick del proyecto. Este corte no necesita
arte, audio ni nuevas descargas. Fuentes Unreal intactas; no se infiere comportamiento desde nombres.

## Secuencia y reparto

1. **Actual:** autoridad interna y cuerpo de prueba separado.
2. **Siguiente:** montaje del piloto y cubierta móvil en ensayo acotado; publicar pose y ACK coherentes,
   neutralizar al salir y reconciliar nave/personaje con snapshots viejos y latencia.
   Integrar también la política de fallo del pump: LocalServer aplica comandos antes de `stepWorld`;
   el reintento de preparación interna no revierte esos comandos externos ni sus ACK.
3. Pasajeros, movimiento relativo y baja/reentrada seguras; después soporte/desprendimientos y módulos.
4. D10 viaje/encuentro NPC; M5/D09 antes de jettison de bienes, pérdidas, reparación o custodia reales.

Luna escribe el adaptador puro y pruebas delimitadas, revisa la costura/lifecycle en solo lectura.
El principal conserva contrato, controlador de autoridad, integración World/detach y aceptación.
[Pruebas y límites de la entrega](../delivery/d08c1-naval-authority.md).
