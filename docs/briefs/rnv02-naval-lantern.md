# RNV02 — farol funcional a bordo

AREA07, 2026-10-10. Continúa el [plan naval](area07-naval-action-plan.md) después de RNV01.
Base de implementación: `758a217`, GM02/refugio/Tala. Integración con L06b: alpha.27/protocolo 39;
la revisión visual inicial usa alpha.26/protocolo 38 antes de combinar ambos frentes.

## Resultado y reglas

Construir el farol en B, acercarse y usar V o el botón táctil para encender/apagar una luz cálida que
acompaña la nave. Cuesta una madera y un hierro, masa 1, HP 10, una casilla de cubierta operativa.
Empieza apagado. No consume combustible en este corte. Los visitantes cercanos pueden usar su interruptor;
no introduce cerradura ni permisos domésticos nuevos. Un farol roto deja de alumbrar y pierde su estado
encendido: hay que repararlo con materiales y encenderlo otra vez. Retirarlo y reconstruirlo crea otra instancia.

La noche actual se conserva hasta el siguiente checkpoint visual: el objetivo del autor sigue siendo
noche casi negra sin luz, también en móvil/bajo. No habilitar esa oscuridad antes de aceptar fuentes útiles.

## Autoridad y conservación

- `ship.litLanterns` opcional contiene IDs estables de condición vivos, únicos y ordenados, hasta 600.
  Legacy/ausente significa apagado; saneado y persistencia de condición eliminan referencias inválidas,
  destruidas o retiradas. El plano no cambia al accionar un farol y `ship.rev` tampoco.
- Comando explícito `raftLantern`: `id`, `partId`, `expectedRev`, `expectedLit`, `lit`, `opId`.
  Servidor exige actor/dueño vivos, alcance 1,7 en la misma banda de piso (tolerancia 0,6), actor libre
  de acción/timón y acceso de mutación M5 de ambas cuentas cuando corresponda. Pausa/bloqueo impiden despacho.
- Reintento exacto recibe replay sin segundo guardado; payload distinto con mismo ID se rechaza.
  Recibos de sesión acotados a 64 por actor y 256 actores. No constituyen diario durable nuevo.
- La mutación marca/guarda el perfil canónico del dueño por CAS M5 existente. ACK privado al actor;
  snapshot público replica solo las tuplas operativas encendidas. No añade SQL, flags ni otra autoridad.
  El ACK de gameplay no acredita commit durable: una caída antes de confirmar el save puede perder el último cambio.
- UI ES/EN sin luz optimista, reintento exacto una vez a 1 s y timeout 5 s; invalida acciones de otra sesión.
  V/toque selecciona entre puerta/farol por distancia y conserva las acciones navales F/E/G.
  Y centra la cámara; V estaba duplicado con esa acción y C pertenece a la ficha del personaje.

## Render y reutilización

Se reutilizan catálogo y malla procedural del farol, con jaula abierta que deja visible el núcleo.
El núcleo emissive cambia visibilidad sin reconstruir
la balsa; fuente cálida en los uniforms de `LocalLights`, transformada por pose/nivel de la nave. Se elimina
al apagar, destruir, retirar o desconectar. Presupuestos existentes 4/8/12 luces, fuente de la nave ocupada
priorizada para que decoración cercana no la anule. Sin luz Three.js por pieza ni texturas/dependencias nuevas.
La luz local no tiene sombras/oclusión por pared; no equivale a simulación de propagación ni prueba de FPS físico.

Candidato concreto comprobado en solo lectura: `C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\Assets\Meshes\SM_Torch.uasset`
(21.751 B) y `Blueprints\BP_Building_Torch.uasset` (35.153 B). Miniatura registrada: antorcha azul alta,
distinta del farol naval cálido de madera/hierro. El [inventario](../research/unreal-assets/survival/FINDINGS.md)
requiere exportación GLB/ajuste de estilo; Blueprint no aporta lógica browser portable. Se conserva el farol actual;
fuente Unreal intacta y sin exportación en este corte.

## Aceptación

Pruebas significativas de coste/soporte vivo, saneado, daño/reparación, alcance/nivel, visitante, revisión,
no-op/replay, guardado/reentrada, permisos/pausa/ACK privado; render on/off sin recreación, movimiento/giro,
retiro de fuentes y presupuesto con luces coincidentes. Navegador real en bajo/alto, ES/EN y touch con
editor/acción/reparación pagados; fixtures de materiales, reubicación y daño se identifican explícitamente.
Publicación requiere revisión/imagen/health y entrada pública reales. [Evidencia y límites](../delivery/rnv02-naval-lantern.md).
