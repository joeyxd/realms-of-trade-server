# D08c.8 — masa, volumen y porte legible

Continúa D08c.7 y el enfoque aprobado en [hoja naval §2.1](../NAVAL-ROADMAP.md).
Estado inicial: bodega/mochila comparten `w` para espacio; el rig emplea ese valor como masa,
pero `raftStats` emplea la mitad. Corregir esa divergencia antes de límites nuevos.

## Contrato del corte

- Catálogo con `volume` y `mass` independientes. Volumen conserva exactamente el `w` anterior;
  `w` queda como alias legacy. Guardados mantienen ids/conteos/capacidad, sin migración ni recorte nuevo.
- Masa inicial, en unidades de juego uM (no kg): piedra 4/volumen 2, hierro 6/3, lona 1/2,
  balas 5/3, tabaco 0.5/1 y seda 0.25/1. El resto conserva masa igual al antiguo `w`.
  Son valores iniciales para distinguir densidad; balance humano pendiente.
- `holdMass` es la fuente del peso de bienes para economía/pilotaje; `holdUsed` y límites de
  transferencia/producción/editor siguen midiendo volumen uV. Sin bloqueos nuevos por masa.
- Lectura privada por snapshot y bodega: masa de nave equipada, bodega y mochila del dueño;
  masa total, flotación, porte nominal restante/exceso y espacio restante. Revisión de nave y
  comercio identifican su estado. Inventario ajeno no se publica en registros públicos.
- Durante viaje se usa el rig autoritativo operativo; al estar en tierra, la lectura es una
  previsión para reembarcar con la mochila actual y piezas que sobreviven al daño de sesión.
- Panel de bodega y editor muestran la lectura confirmada; vista previa de colocación descuenta
  materiales de bodega→mochila en copias, suma masa de la pieza y cambia espacio según módulos.
  El servidor conserva validación final de materiales, soporte, ocupantes y guardado.
- HUD naval reutiliza su espacio actual para indicar porte; no añade otra ventana.

## Límite de esta primera lectura

El porte mostrado es **nominal por flotación existente**: `max(0, flotación − masa equipada − carga)`.
No se presenta como certificado de estructura/desplazamiento seguro. La fórmula aprobada completa
`min(estructura, desplazamiento seguro) − nave − tripulación` sigue para el próximo corte,
junto a materiales/refuerzos, reserva y umbrales calibrados. Masa corporal de piloto/tripulantes,
mochilas de invitados y asignación individual de carga a bodegas siguen pendientes; no se simulan
sin incorporarlas también al manejo. Cajas/pisos/velas pesan; solo cimientos actuales flotan.

## Reutilización y evidencia requerida

Auditoría Luna acotada: [D06 reuse](../research/unreal-assets/D06-REUSE.md) y
[D08 reuse](../research/unreal-assets/D08-REUSE.md). Crate Dreamrise ya integrado, 51,684 bytes/
204 triángulos. No hay icono portable pertinente; `T_Mat1Image`/Sword/HPBottle son uasset sin
export visual útil para porte. Reutilizar UI/CSS y modelos actuales; cero nuevas texturas y
fuentes `C:\Unreal` intactas.

Verificar densidades distintas con igual volumen, conservación al transferir, cajas vs flotadores,
guardados anteriores, lectura privada/revisiones, rig vivo y daño. Capturas inspeccionadas PC,
móvil horizontal y vertical rotado, con fixtures declaradas. Autoría/diseño/integración del principal;
Luna: auditoría/UI acotada/tests/harness. Sin SQL, publicación ni aceptación de FPS/balance físico.
