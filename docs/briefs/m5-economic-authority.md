# M5: comercio y aportes en una sola autoridad

El jugador debe poder comprar, vender, mover carga y aportar a la carpintería de Salty Shore sin que
un reintento descuente dos veces ni un reinicio separe su mochila del avance del mundo.

## Contrato y límites

- `mn_profiles` y `mn_worlds` siguen siendo las filas M5 existentes. No se monta el almacenamiento
  `mn_comm_characters` ni otra sesión/autosave A1. Solo se reutiliza su regla pura de aporte.
- SQL014 confirma perfil, mundo y recibo inmutable en una transacción. El servidor autentica la cuenta,
  comprueba acceso físico y construye la propuesta; el cliente solo envía el comando.
- El UUID del recibo deriva de mundo, cuenta y `opId`. El mismo comando recupera su resultado; cambiarlo
  con la misma identidad devuelve duplicado. Un recibo histórico no vuelve a instalar su snapshot.
- Compras/ventas conservan la cotización exacta; la compra de materiales desde el editor de la balsa
  confirma oro, carga y stock juntos. Bodega conserva propietario, distancia, capacidad y revisión.
  Aportes requieren estar vivo, quieto, fuera de combate y junto al banco en tierra firme.
- El aporte aceptado es el menor entre lo solicitado y lo que falta; debe existir en la mochila.
  La UI limita a 500 unidades y a la cantidad que lleva el jugador. No anticipa débitos ni avance.
- La obra se guarda en los metadatos del mismo mundo. Una vez presentes, `mn_save_world` exige conservar
  esos metadatos exactamente: un escritor antiguo no puede borrarlos al guardar economía.

## Confirmación y recuperación

El host reserva la cuenta y pausa brevemente la simulación global de esta alfa de cuatro conexiones.
Primero drena los CAS anteriores; después confirma la propuesta fuera de la simulación y la aplica
sincrónicamente antes del siguiente tick. Solo entonces publica perfil y respuesta privada.

Una respuesta perdida se resuelve leyendo el recibo y, si todavía no existe, reenviando exactamente
la misma propuesta. Cierre/desconexión esperan el resultado antes del guardado final. Si no se puede
determinar el resultado, la autoridad se bloquea y requiere recuperación operativa; no escribe un
snapshot viejo sobre un resultado posiblemente confirmado. El supervisor y el actualizador no
reinician automáticamente alrededor de una operación económica incierta.

## Activación

Aplicar `server/migrations/014_economic_operations.sql` después de SQL001–013. Configuración privada:

```dotenv
MN_ECONOMIC_OPERATIONS=1
MN_COMMUNITY_REQUIREMENTS={"madera":40,"piedra":20}
```

40/20 es una meta provisional de alfa, no el balance definitivo. El arranque no permite cambiar los
requisitos de una obra ya creada. Una SQL014 ausente impide admitir jugadores con la opción activada.
Esta composición todavía excluye los coordinadores opcionales de perlas/muerte/botín.

Se reutiliza el banco S19 existente y su interfaz; el inventario Unreal/FAB describe la caja de
almacenamiento como visual, sin autoridad de permisos ni persistencia. No se añade arte.

## Alcance pendiente

Esto cierra el mercado cotizado, compra de materiales de balsa, carga ordinaria y aportes M5. Recursos, crafting, equipo de NPC,
producción autónoma y demás acciones conservan sus rutas de snapshot existentes. No cierra todo M5,
aislamiento por personaje/mundo, leases distribuidas ni una política de reloj offline. Completar la
barra de carpintería no construye todavía un edificio ni concede recetas nuevas.
