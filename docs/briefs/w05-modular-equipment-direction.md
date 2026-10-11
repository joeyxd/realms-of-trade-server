# W05 — taller de equipo creado por jugadores

Fecha: 2026-10-08. **Dirección aprobada por el autor; implementación futura.**
[Plan Web3](../../PLAN-WEB3.md#13-creaciones-de-jugadores-después-del-primer-piloto),
[reglas de equipo](w00-equipment-rules.md). Registrar este camino no adelanta W05 sobre el piloto
equipo/tierra ni cambia la cola general; se retoma W02/Amoy después de esta decisión.

## Acuerdo y alcance

El autor acepta empezar por un editor de piezas y ampliar después a modelos propios, generación
por texto/imagen y herramientas de escultura. Confirma que hojas, mangos/empuñaduras, guardas y
otras piezas del catálogo deben poder aportar diferencias de atributos. Reconoce el trabajo de
crear ese catálogo; empezar con una familia de sable y pocas piezas compatibles es el primer piloto.
Armaduras deformables llegan después del contrato de cuerpo/rig y de probar accesorios rígidos.

El taller cabe en ciudad o barco-hogar cuando su estación/autoridad exista. La especialización de
artesanos y materiales regionales puede alimentar producción y comercio; oficios, aprendizaje y
acceso al taller requieren su diseño/implementación y no se conceden por tener un token.

## Diseño, receta e instancia

- **Diseño/plano:** composición visual, referencias a piezas aprobadas, colores/texturas, versión,
  compatibilidad, autor y hash. Reutilizar un plano no crea equipo ni entrega materiales.
- **Receta:** componentes funcionales por ID de catálogo, materiales y oficio; el servidor determina
  costes, atributos posibles, restricciones y probabilidades. Las piezas pueden distribuir el
  presupuesto de stats de manera diferente, con compensaciones, sin sumar poder libre por adornos.
- **Instancia fabricada:** consume recursos una sola vez y conserva identidad, resultado y procedencia.
  La repetición tras respuesta perdida/reinicio no vuelve a consumir ni a tirar atributos. Reventa
  conserva el resultado; fabricación, reservas y recibos requieren persistencia verificada.

La apariencia sigue con cero stats. Un GLB, texto, imagen o escultura suministra visuales: no declara
daño, afijos, alcance, colisión ni permisos. Si una creación es funcional, sus decisiones mecánicas
se expresan mediante IDs/reglas reconocidos por el servidor. La silueta debe conservar legibilidad,
medidas y animación compatibles con su familia; no convertir tamaño visual arbitrario en alcance.

El contrato W00 actual solo valida apariencia o base/nivel/rareza/afijos del sistema existente:
**no representa todavía composición modular, recetas, oficio ni procedencia de fabricación**.
Ampliarlo necesita catálogo/versionado, balance y pruebas propias; esta dirección no modifica sus
formatos ni autoriza mint desde payloads de jugadores.

Materiales raros pueden especializar/mejorar el resultado dentro del sistema normal. Propuesta
inicial: entregar siempre una pieza y variar calidad, con resultados posibles visibles antes de
consumir. Garantías mínimas, probabilidades, fallos/destrucción, recetas, valores de atributos,
costes, aprendizaje, copias y licencias siguen por concretar; no fijar cifras por este acuerdo.

## Entregas futuras y coste de contenido

| Corte futuro | Resultado | Aceptación mínima |
|---|---|---|
| W05a | Catálogo pequeño de piezas de sable, uniones/pivotes y editor con vista previa/plano | Piezas compatibles, diversidad visual y presupuesto PC/móvil; no inferir stats de la geometría |
| W05b | Receta y fabricación funcional autoritativa con diseño propio | Componentes aportan diferencias dentro del presupuesto; consumo/resultado atómicos, roll único, recuperación sin duplicados |
| W05c | Publicación/catálogo de creadores; GLB propio e IA como entradas adicionales | Procesamiento acotado, autoría/licencia/copia definidas, arte y compatibilidad revisados antes del uso compartido |
| W05d | Escultura acotada, pintura y prendas/armaduras | Deformación/rig/cuerpo revisados, animaciones y lectura de combate, descarga/memoria/rendimiento físico medidos |

Planificar por piezas únicas, no modelar cada combinación completa. Compartir conexiones, materiales
y atlas, y hornear/componer una salida aprobada para evitar que cada adorno aumente draw calls sin
límite. Cantidad inicial y topes se deciden con el rig/estilo y mediciones, no mediante un catálogo
grande antes de probar una combinación en movimiento.

GLB es el primer formato propuesto; OBJ mediante conversión posterior. Requisitos explícitos de
ejes/unidades/pivote, triángulos, materiales/texturas, huesos cuando aplique y archivos/autorizaciones.
El importador interno actual no es un servicio seguro de subida de jugadores. La generación IA
produce borradores que pasan la misma aceptación; proveedor, coste, límites y acceso se deciden
antes de abrirla al público. No implementar un escultor completo como dependencia del primer sable.

## Creación y Web3 opcionales

Crear, fabricar y jugar siguen disponibles sin wallet. Publicación/venta del diseño o tokenización de
una pieza son expansiones opcionales; distinguir licencia de diseño de instancia física, autoría
de titularidad y número de copias de existencia de equipo. Comprar un plano/licencia no crea una
instancia, y un token no regenera equipo perdido mientras otra persona lo conserva.
Licencias/regalías, tiradas, custodia, pérdidas y pagos siguen sus decisiones de W00/W03/W05/W06.

## Reutilización revisada

[ActionRPG](../research/unreal-assets/actionrpg/FINDINGS.md) identifica
`Assets/PickupMeshes/OneH_Sword/SkeletalMesh/SK_ShortSword.uasset`, familias de armas e iconos
`T_SwordImage`/`T_ArmorImage`: referencias candidatas, con exportación/rig/materiales por verificar.
No se encontró un kit aprobado de hojas/mangos/guardas intercambiables ni stats portables.
[Inventario](../research/unreal-assets/SUMMARY.md) identifica `SM_RepairBench.uasset` como banco
visual; [reutilización D06](../research/unreal-assets/D06-REUSE.md) recoge `BP_Holdable_BuildHammer`
como referencia de interacción. Un Blueprint/nombre no prueba recetas o autoridad operativas.
Reusar `src/data/items.js`, `src/sim/items.js`, banco existente y contrato de assets donde encajen;
no modificar fuentes Unreal ni producir/importar arte al registrar este plan.

Precedentes de investigación: [TennoGen](https://www.warframe.com/en/news/tennogen-101),
[herrería Bannerlord](https://moddocs.bannerlord.com/asset-management/weapon_smithing/),
[edición dentro de Roblox](https://create.roblox.com/docs/avatar/in-experience-creation).
Cubren partes distintas; no prueban la combinación completa ni implementación en MAREA NEGRA.

**Estado:** dirección guardada; cero piezas nuevas, editor, recetas modulares, procesamiento de
subidas, generación IA, nuevas reglas de economía o tokens comerciales implementados en este acuerdo.
