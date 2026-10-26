# PLAN WEB3 — equipo premium, tierra y creaciones comerciables

Actualización: 2026-10-08. **Desarrollo autorizado; W01 y contrato de contenido de ambas modalidades de equipo
implementados y verificados localmente; W02a/W02b vinculan cuenta/wallet por firma en backend opt-in
y panel probado con proveedor simulado. W02c incorpora montaje por configuración y comprobación
de arranque sobre SQL local. W02d añade un comando independiente para comprobar SQL y RPC
configurados, verificado contra fixtures locales. W02e añade lectura ERC-721 en un bloque por
número/hash, con contrato explícito y CLI independiente. W02f completa la lectura de cantidades
ERC-1155 por holder/tipo/bloque. W02g prueba ambos lectores y CLIs contra bytecode Solidity
ejecutado en EVM local: 49/49 seleccionadas (7 nuevas + 42 W02d/e/f). W02h añade diagnóstico
RPC Amoy por hash: 58/58 seleccionadas locales y consulta pública real satisfactoria, sin gas.
W02i prepara un contrato ERC-721 experimental restringido a Amoy y un artefacto reproducible;
68/68 seleccionadas locales (10 nuevas + 58 anteriores). W02j-a prepara datos de creación sin firma
y runtime esperado para revisión: 78/78 seleccionadas locales (10 nuevas + 68 previas).
W02j-b añade la herramienta de simulación de creación/estimación read-only: 97/97 locales
(19 nuevas + 78 previas); corrida pública pendiente de direcciones y endpoint explícitos.
Supabase live, extensión, simulación/envío público y NFT público siguen pendientes.**
**Red elegida por el autor, 2026-10-08: Polygon PoS; piloto en Amoy.** Selección documentada y
plantilla alineada; origen/proveedor operativo y piloto NFT público siguen pendientes. Web3 conserva
su carácter opcional para el juego ordinario. Véase §5.1.
Continuidad: [PLAN-DELIVERY](PLAN-DELIVERY.md), [M5](PLAN-M5.md), [M7](PLAN-M7.md),
[M8](PLAN-M8.md) y [dirección naval](docs/NAVAL-ROADMAP.md).

## 1. Dirección del autor y propuesta de producto

| Decisión | Estado |
|---|---|
| Añadir una capa Web3 con tierra, equipo premium y contenido creado por jugadores que pueda tokenizarse y comerciarse | Solicitada por el autor |
| Primer piloto centrado en **equipo premium y tierra** | Confirmado por el autor: opciones 2 y 3 |
| Equipo premium con **apariencias coleccionables y piezas funcionales comerciables**, ambos con reglas claras | Confirmado por el autor el 2026-10-07 |
| Creación de equipo ingame: primero editor por piezas con diferencias de stats de catálogo, plano/receta/instancia; después GLB/IA/escultura | Camino aprobado por el autor el 2026-10-08; implementación futura W05, sin adelantarlo al piloto actual |
| Iniciar el desarrollo de la base Web3 | Autorizado por el autor el 2026-10-07; primer corte W01 de almacenamiento aislado |
| Red de la capa Web3 | Polygon PoS elegida por el autor el 2026-10-08; Amoy para el piloto de pruebas |
| Wallet, medio de pago, precios, tiradas, comisiones y prioridad en la cola general | Pendientes; USDC nativo y gas patrocinado son la dirección propuesta para pagos futuros |
| Ventajas del equipo, pérdidas, custodia y alcance de las escrituras | Propuestas por concretar; no acordadas |

Visión: construir una vida en tierra o en un barco-hogar, adquirir y transmitir bienes reconocidos por
el juego y, después, publicar creaciones propias. El token representa un derecho definido sobre un activo;
el juego sigue resolviendo construcción, uso, daño, producción y comercio regional.

Ejemplo futuro: una jugadora compra una edición de sable y un solar en Aldea Coralina, usa el equipo,
construye su taller y vende la escritura a otro jugador. Más adelante un creador publica un plano de
casa o una vela y vende copias. Comprar el plano no crea materiales ni entrega el edificio construido.

### 1.1 Equipo premium

El autor elige **ambas modalidades**. [Reglas y contrato de contenido](docs/briefs/w00-equipment-rules.md):

- **Apariencia coleccionable:** derecho de usar un diseño compatible; no entrega equipo ni añade stats,
  hitbox o efectos mecánicos. Arte, compatibilidad visual y proyección de licencias requieren su corte.
- **Equipo funcional:** instancia concreta definida por el servidor, con base/nivel/rareza/afijos del
  sistema normal. Comprar o revender conserva sus atributos; no hace reroll ni concede niveles o maestría.

Las dos usan contenido validado y vinculado por hash al registro W01. Esa validación no acredita
procedencia legítima, autoriza mint ni concede uso jugable. No introducir requisitos de nivel que el
equipamiento actual no tiene. La funcional conserva como recomendación el riesgo normal de pérdida;
la permanencia de una licencia visual separada sigue propuesta. Cerrar pérdidas, saqueo, destrucción,
reparación y custodia antes de habilitar ventas. El token no puede recuperar automáticamente una
instancia perdida y dejar otra en manos del saqueador.

### 1.2 Tierra

Propuesta: escritura de **una parcela concreta del mundo persistente**, con ubicación y permisos de
construcción; después pueden añadirse talleres, almacenes y vivienda modular de M8.
La escritura describe uso dentro de MAREA NEGRA y no presupone tierra física ni rentabilidad.

Antes de vender: cerrar duración del derecho, mantenimiento/deuda, abandono, recuperación, cambios de
mapa y límites por cuenta. M8 plantea algunas de estas reglas como decisiones por confirmar: tokenizar
no las convierte en acuerdos. Una venta debe declarar si incluye edificio, decoración, inventario,
producción pendiente y deuda; cada componente se transfiere o se excluye expresamente.
Recomendación: conservar solares obtenibles jugando y acceso a servicios de ciudad para quienes no compren.
Alquileres y permisos compartidos son una expansión, no parte de la primera transferencia.

### 1.3 Creaciones de jugadores, después del primer piloto

**Camino aprobado por el autor, 2026-10-08:** crear equipo ingame empezando por un editor modular;
hojas, mangos/empuñaduras, guardas y otras piezas del catálogo podrán aportar diferencias de stats.
Primer piloto: una familia de sable y pocas piezas compatibles; ampliar después a importación GLB,
generación por texto/imagen y escultura/pintura. Armaduras requieren primero rig/cuerpo y deformación
aceptados. [Dirección, fases y reutilización W05](docs/briefs/w05-modular-equipment-direction.md).

Separar **diseño/plano**, **receta/materiales/oficio** e **instancia fabricada**. El servidor resuelve
atributos/probabilidades con componentes reconocidos y presupuesto de equipo normal; una geometría
subida/generada no declara stats, alcance o permisos. Consumir materiales y crear el resultado una
sola vez, sin repetir el roll por reintento/reventa. Materiales raros pueden especializar el objeto;
valores, recetas, garantías/probabilidades, fallos, licencias y cantidades siguen por concretar.
El contrato W00 actual no implementa composición modular ni acredita fabricación legítima.

Ruta futura: editor → validación/versión aprobada → plano → fabricación/uso/comercio ingame;
publicación/licencia/edición tokenizada son opciones posteriores. Crear y jugar no exige wallet.
Tirada, autoría, licencia de uso y reglas de copia acompañan lo publicado; poseer una copia no
transfiere automáticamente derechos de autor ni crea materiales/equipo. Velas, decoración y planos
de construcción siguen como ampliaciones. Esta dirección no sustituye la cola W02–W04 actual.

## 2. Base real revisada y brechas

| Base existente | Evidencia | Brecha para tokenizar |
|---|---|---|
| Cuentas/perfiles y persistencia con CAS, operaciones y recuperación | [PLAN-M5](PLAN-M5.md), `server/profileSessions.mjs`, `server/pearlJournal.mjs` | La partida durable completa conserva pendientes; no equivale a un puente con blockchain |
| Equipo en mochila/equipado con UID local `u` y contador de perfil | `src/sim/systems/inventory.js`, `src/sim/items.js` | Identidad global durable, transferencia entre dueños y vínculo único con el token |
| Solares `town/i`, `owner`, edificio, almacén y deuda; escrituras `eco.deeds` | `src/sim/economy/plots.js`, `src/sim/systems/trade.js`, [PLAN-M8](PLAN-M8.md) | Identidad estable por mundo/generación y transferencia atómica de escritura/estado afectado |
| Compra/venta de mercancías en mercados autoritativos | `src/sim/systems/trade.js`, [PLAN-M7](PLAN-M7.md) | Mercado entre jugadores para activos únicos y liquidación de pagos |
| Construcción modular de balsa; dirección de vivienda terrestre | [PLAN-M6](PLAN-M6.md), [PLAN-M8](PLAN-M8.md) | Editor/publicación/licencias para creaciones; el núcleo de solares no es un editor libre de vivienda |

Estado de referencia: M5 documenta SQL009/010 aplicadas por el autor, con verificación independiente
Supabase aún pendiente, y montaje opcional de muerte completa probado localmente. El disparo automático
desde combate y el ciclo durable de botín mantienen pendientes. Consultar sus últimos checkpoints antes
de implementar: este documento no revalida esas pruebas ni activa movimientos durables.
La revisión inicial no encontró wallets/contratos ni integración con blockchain. W01 añade el registro
aislado descrito en §6; esa base todavía no concede propiedad tokenizada en la partida.

## 3. Autoridad y representación propuestas

- **Blockchain:** titularidad/transferencias de los tokens reconocidos y liquidación del mercado elegido.
- **Registro del servidor:** identidad del activo, vínculo con su token, estado de uso y proyección del
  titular confirmado. No puede asignar un token a otro dueño por un snapshot viejo.
- **Simulación:** combate, construcción, recetas, desgaste y permisos de gameplay. Sin RPC, wallet,
  firmas ni esperas de red en `src/sim/**`; aplicar cambios confirmados entre ticks por la autoridad existente.
- **Cuenta:** Supabase Auth sigue siendo identidad de juego; la wallet se vincula mediante prueba de
  control y no reemplaza automáticamente al personaje, al dueño `eco.id` ni a sus permisos.

Registro propuesto: `assetId`, clase, `worldId/worldGeneration` cuando corresponda, contenido/versiones,
`chainId/contract/tokenId`, titular observado, estado de custodia/uso y versión CAS.
Unicidad del vínculo en ambas direcciones. Para ediciones con varias copias, modelar cantidad y reservas;
no fingir que un token de edición identifica cada instancia individual.
La metadata identifica contenido/licencia/tirada; los valores jugables salen del catálogo del servidor.

### 3.1 Activación y transferencias sin uso simultáneo

**Recomendación para el piloto:** custodia contractual (escrow) mientras el activo tiene uso en el juego.
El contrato registra su beneficiario y el servidor concede un único derecho de uso tras confirmar el depósito.
Retirar o vender exige revocar ese derecho y cerrar las mutaciones afectadas antes de liquidar/liberar el token.
Este modelo necesita acuerdo de producto y contrato; todavía no existe.

Un token en una wallet externa puede transferirse libremente según su contrato, pero en este modelo no
tiene una instancia activa en el juego. Su nuevo titular podrá solicitar activación tras reconciliar.
Una transferencia entre wallets vinculadas a la misma cuenta tampoco crea una segunda instancia.
Préstamos/alquileres y delegación de uso quedan para un contrato posterior.

Una venta de parcela bloquea los permisos que podrían cambiar lo incluido en ella hasta completar o
cancelar la operación. Nunca mantiene a vendedor y comprador construyendo/retirando la misma reserva.
Separar título del hogar, materiales y carga: tokenizar una escritura no convierte mercancías en un
almacén invulnerable que pueda teletransportarse entre regiones.

## 4. Recuperación y mercado

La base de datos y blockchain **no comparten una transacción ACID**. Usar intención durable, estados y
recibos reconciliables; el esquema siguiente es propuesta, no una ampliación aprobada de SQL010:

1. Validar titular, cuenta, activo, versión, oferta, vigencia y autorización específica. Reservar activo
   y permisos afectados; persistir `operationId` y request exacto antes del envío externo.
2. Desactivar el uso si corresponde; registrar su confirmación. Preparar una venta en la que el contrato
   liquide token/pago/comisiones juntos, con oferta identificable y protección contra su ejecución repetida.
3. Guardar el hash de transacción y observar confirmación según la política de la red. Mostrar
   pendiente/confirmada/fallida/en revisión; un envío o timeout no es compra terminada.
4. Proyectar la titularidad confirmada con CAS, reconciliar permisos/perfiles/escrituras y aplicar en tick.
   Solo entonces publicar éxito y habilitar al nuevo dueño. Persistir el recibo para reintentos/restarts.
5. Si falta respuesta, consultar recibo, transacción y estado canónico antes de actuar. Nunca reconstruir
   otra compra ni reenviar a ciegas; reemplazos de transacción deben conservar la misma intención.

Guardar cursor/hash de bloque e identidad del evento; soportar duplicados, eventos fuera de orden,
reorganización y caída del RPC. Si titularidad o resultado son inciertos, retener la reserva y no conceder
derechos nuevos hasta reconciliar. Si el contrato ya liquidó, una caída SQL exige recuperación, no otra venta.
Una reorganización que invalide una proyección exige cercar el activo y reconciliar antes de volver a usarlo.
Separar este registro de los recibos de muerte/perlas; reutilizar sus principios, no sus DTOs ni triggers.

Mercado propuesto: catálogo de equipo y solares, ficha de derechos/estado, publicar oferta, comprar,
cancelar, historial y estado visible. Mostrar precio total, red/moneda, comisiones y quién paga gas.
Tiradas, límites de acuñación, gas patrocinado y comisiones serían controles del operador, no valores
fijos escondidos en la UI. Tener wallet sigue siendo opcional para el loop ordinario de juego.

## 5. Tecnología candidata, sin selección de proveedor

Para un piloto EVM, evaluar **ERC-721** para parcelas/equipo individual y **ERC-1155** para ediciones
de apariencias/copias. ERC-721 define seguimiento y transferencia de NFTs; ERC-1155 permite múltiples
tipos y cantidades en un contrato. El formato comercial sigue por validar; la red elegida es Polygon PoS.
[ERC-721](https://eips.ethereum.org/EIPS/eip-721), [ERC-1155](https://eips.ethereum.org/EIPS/eip-1155).

Vinculación candidata: **Sign-In with Ethereum**, verificando dominio, URI, red, nonce de un solo uso,
vigencia y firma del mensaje; contemplar wallets de contrato según el estándar. Autenticarse y autorizar
una venta son acciones distintas. Cambiar wallet exige una transición explícita y no migra tokens
automáticamente. [ERC-4361](https://eips.ethereum.org/EIPS/eip-4361).

El mercado propio podría liquidar comisiones de MAREA NEGRA y regalías del creador según las reglas
publicadas. ERC-2981 comunica regalías; su cumplimiento fuera del mercado propio es voluntario, por lo
que no garantiza cobro en todas las reventas. [ERC-2981](https://eips.ethereum.org/EIPS/eip-2981).

La red elegida debe probar wallet PC/móvil, costes medidos, disponibilidad RPC, confirmación,
recuperación y soporte contractual. Moneda de pago y posible patrocinio se concretan después de medir.
El piloto usa Amoy; no requiere crear una moneda propia ni habilita venta con dinero real.

### 5.1 Polygon PoS elegida; Amoy para pruebas

Decisión del autor, 2026-10-08: usar **Polygon PoS** como red de la capa Web3, considerando el coste
de operación y el acceso a OpenSea. Mantener una sola red de mercado inicialmente y el juego ordinario
jugable sin wallet; conectar, tokenizar o comerciar activos Web3 son acciones opcionales.

| Entorno | Red | Chain ID | Gas | Estado |
|---|---|---|---|---|
| Piloto de pruebas | Polygon Amoy | `80002` | POL de prueba | Diagnóstico público W02h satisfactorio; contrato preparatorio W02i, sin NFT público ni lector contra ese NFT |
| Producción futura | Polygon PoS | `137` | POL | Red elegida; sin contratos, tokens, pagos o despliegue Web3 |

Datos verificados en la [documentación de Polygon](https://docs.polygon.technology/pos/reference/rpc-endpoints).
[OpenSea admite Polygon](https://support.opensea.io/en/articles/8867082-which-blockchains-are-compatible-with-opensea);
eso permite evaluar la publicación de nuestras colecciones, pero no acredita integración, indexación,
compradores ni liquidez de activos todavía inexistentes. El piloto Amoy no presupone soporte OpenSea testnet.

Para pagos futuros, la dirección propuesta es **USDC nativo** de Circle y gas patrocinado con límites
por cuenta y globales. Referencias de [Circle](https://developers.circle.com/stablecoins/usdc-contract-addresses):
Polygon PoS `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359`; Amoy
`0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582`, token de prueba sin valor monetario.
Son referencias para el diseño posterior, no configuración de pagos activa. USDC paga el precio del bien;
el gas de la red se paga en POL. Proveedor de wallet/RPC/patrocinio, presupuesto y comisiones siguen abiertos.

`deploy/marea-negra.env.example` conserva `MN_WEB3_WALLET_ENABLED=0` y ejemplifica el chain ID `80002`.
Origen y RPC requieren valores explícitos del operador; no se elige un proveedor por defecto.
El montaje EVM existente sigue validando la red configurada y el diagnóstico W02d exige que el RPC coincida.
No se han leído ni modificado archivos `.env` reales en esta selección.

Pasar de Amoy a producción requiere desplegar/verificar contratos y configurar identidades de esa red:
contratos, tokens y vínculos de prueba no se trasladan al cambiar chain ID/RPC. W02a no permite
sobrescribir o revincular wallets; cualquier transición de vínculos requiere su corte explícito.
W02e implementa un [lector ERC-721 aislado](docs/delivery/w02e-erc721-reader.md) para un contrato y
token explícitos en un bloque identificado por número/hash. Usa EIP-1898 sin fallback y conserva
la red configurada; es una observación sin vínculo token/activo ni autorización jugable.
W02f añade el [lector de ediciones ERC-1155](docs/delivery/w02f-erc1155-reader.md): cantidad decimal
exacta por holder/tipo, incluido cero, con el mismo transporte y bloque explícito. No determina
existencia/tirada/licencia ni concede derechos; reservas por cantidad y custodia siguen pendientes.
W02g añade el [ensayo con bytecode EVM local](docs/delivery/w02g-local-evm-rehearsal.md): fixtures
OpenZeppelin compilados, acuñación/transferencias como mensajes EVM, lectura histórica y CLIs contra
loopback. Chain ID 31337 y bloques/canonicalidad sintéticos; 7 nuevas + 42 de regresión locales.
No despliega contratos públicos ni acredita finalidad o compatibilidad RPC de Amoy.
W02h añade el [diagnóstico RPC Amoy](docs/delivery/w02h-amoy-rpc-check.md), cinco lecturas acotadas
con identity precompile y bloque releído. 9 nuevas + 49 regresión locales; CLI real contra RPC público
documentado por Polygon: red 80002, selectores por hash aceptados y echo/bloque esperado, sin gas.
No prueba cumplimiento completo EIP-1898, rechazo de hashes inválidos, finalidad o NFT públicos;
proveedor operativo sigue abierto.
W02i prepara un [contrato experimental ERC-721](docs/briefs/w02i-amoy-erc721-pilot.md) separado de
los fixtures W02g: constructor/mint solo Amoy, operador explícito inmutable y metadata constante
sin derechos de juego. Artefacto reproducible y ensayo contra bytecode local; simular 80002
para CHAINID no acredita Amoy real. [Entrega W02i](docs/delivery/w02i-amoy-erc721-pilot.md).
[W02j-a](docs/delivery/w02ja-amoy-deployment-review.md) prepara offline constructor/data con direcciones
públicas explícitas, exige artefacto reproducible y calcula runtime esperado con inmutables; 78/78
locales. Sin RPC, gas/nonce/fees, firma/envío o despliegue. Dirección/wallet del autor aún ausentes.
[W02j-b](docs/delivery/w02jb-amoy-deployment-simulation.md): herramienta local lista, 97/97
seleccionadas (19 nuevas + 78 previas). Creación por hash con runtime exacto, estimación por número,
gasPrice/productos en wei orientativos y bloque/red releídos; transporte privado sin firma/envío.
Ningún RPC externo en ese corte ni costo de producción medido. Falta ejecutar con direcciones/RPC
explícitos; POL de prueba y presupuesto/wallet se revisan antes del envío.
W02j-c: firma/envío y recibos, código/mint/transfer/lectores públicos. W02j sigue sin NFT público.
Origen/servicios y Supabase/wallet reales se aceptan por separado. Véase la secuencia siguiente.
W03/W04 conservan las decisiones abiertas de derechos, pérdidas y custodia.

Reutilización revisada: [inventario Unreal/FAB](docs/research/unreal-assets/SUMMARY.md) aporta arte y
patrones de gameplay, sin dependencia aplicable a esta decisión documental o plantilla de red.

## 6. Cortes propuestos y aceptación

| Corte | Resultado revisable | Dependencias / aceptación | Estado |
|---|---|---|---|
| W00a | Ficha de equipo y escritura: derecho vendido, tirada, uso, pérdidas, deuda e inclusiones | Acordar las decisiones de §7; mantener propuestas identificadas | Ambas modalidades elegidas; [reglas/contrato de equipo](docs/delivery/w00-equipment-content.md) locales, 41/41 pertinentes. Pérdidas/licencias, economía y escritura abiertas |
| W00b | Contrato de identidad, custodia, estados y recuperación | Escenario equipo + parcela; revisar con autoridad M5/M8 y contrastar inventario de arte existente | Contrato de almacenamiento W01 documentado; custodia/token/juego aún propuestos |
| W01 | Registro durable server-only y transferencias aisladas de activos | IDs globales/CAS/recibos; dos compradores, respuesta perdida, restart y claims viejos sin duplicados | Implementado localmente: [entrega](docs/delivery/w01-asset-registry.md), 25/25 pertinentes + 56/56 regresión seleccionada; migración opcional, sin Supabase live ni host |
| W02 | Vincular wallet a cuenta y adaptador de testnet | W01; firma incorrecta/replay/red errónea/revinculación rechazados, secretos fuera de perfiles/chat | Parcial: [W02a backend](docs/delivery/w02a-wallet-link.md) + [W02b navegador](docs/delivery/w02b-wallet-browser.md), 109/109 seleccionadas y 3/3 vistas emuladas históricas. [W02c montaje](docs/delivery/w02c-wallet-runtime.md), [W02d comprobación SQL/RPC](docs/delivery/w02d-wallet-preflight.md), [W02e lector ERC-721](docs/delivery/w02e-erc721-reader.md) y [W02f lector ERC-1155](docs/delivery/w02f-erc1155-reader.md), configuración explícita y verificación local. W02f: 15 nuevas + 27 regresión W02d/e; no concede propiedad jugable. Extensión real, lectores NFT públicos y Supabase live pendientes; diagnóstico RPC Amoy W02h separado |
| W02g | Ensayo ERC-721/ERC-1155 ejecutado en EVM local | W02e/f; bytecode compilado, mint/transfer/historia/revert y lectores/CLIs por hash sin cambiar estado | [Verificado localmente](docs/delivery/w02g-local-evm-rehearsal.md), 7 nuevas + 42 regresión. Paquete de herramientas aislado; sin testnet, pagos o permisos jugables |
| W02h | Diagnóstico RPC público Amoy por hash de bloque | W02d/e; cinco lecturas, identity echo y bloque estable; formato aceptado no prueba finalidad o honestidad | [58/58 locales y consulta pública satisfactoria](docs/delivery/w02h-amoy-rpc-check.md), sin gas. Sin proveedor permanente, NFT público, wallet/Supabase o gameplay |
| W02i | Contrato ERC-721 experimental y artefacto reproducible | W02g/h; operador explícito inmutable, mint restringido, metadata experimental y transferencias estándar; ensayo local separado de Amoy real | [68/68 locales](docs/delivery/w02i-amoy-erc721-pilot.md), 10 nuevas + 58 previas; sin deploy público, pagos, custodia o derechos de juego |
| W02j-a | Preparación offline de datos de despliegue y runtime esperado | W02i; direcciones públicas explícitas, constructor exacto, artefacto reproducible e inmutables contrastados | [78/78 locales](docs/delivery/w02ja-amoy-deployment-review.md), 10 nuevas + 68 previas. Sin RPC, estimación, firma o envío; no es NFT público |
| W02j-b | Simulación de creación y estimación read-only | W02j-a; RPC/direcciones/límite de simulación explícitos; runtime completo, gas y bloque/red contrastados | [Herramienta local lista, 97/97](docs/delivery/w02jb-amoy-deployment-simulation.md), 19 nuevas + 78 previas. Sin corrida pública; gasPrice observado no es fee cap/cotización mainnet. Sin firma/envío |
| W02j | NFT experimental público y lectura histórica en Amoy | W02i/j-a/b; dirección pública del operador/deployer, firma con su wallet, POL de prueba, simulación del despliegue y endpoint explícito; contrato/código/recibos y lectura por bloque contrastados | Parcial: preparación W02j-a y herramienta W02j-b listas localmente; faltan simulación/estimación públicas y W02j-c envío/recibos/lectura. Dirección/wallet aún no suministradas; sin integración jugable o OpenSea |
| W03 | Apariencia compatible y pieza funcional en testnet, activar/usar/desactivar/vender | W00–W02; revocar vendedor, activar comprador una vez y conservar contenido/titularidad tras reinicio | Pendiente |
| W04 | Una parcela experimental tokenizada y transferible | W00–W02 + reglas de propiedad durable acordadas y transferencia M8 por implementar/verificar; escritura/edificio/contenido/deuda coherentes, permisos antiguos revocados | Pendiente |
| W05 | Taller modular y publicación de creadores; diseño/receta/instancia separados | Piloto equipo/tierra aceptado; piezas de catálogo con stats acotados, consumo/roll recuperables, autoría/licencia y coste visual validados | [Camino aprobado](docs/briefs/w05-modular-equipment-direction.md): W05a piezas/editor de sable, W05b fabricación, W05c publicación/GLB/IA, W05d escultura/armaduras; sin implementar ni cambiar prioridad |
| W06 | Preparar lanzamiento con pagos reales | Contratos y recuperación revisados; costes, soporte, términos de venta y decisiones de operación concretos; aceptación del autor sobre esa entrega | Pendiente |

**Demostración inicial propuesta:** A tiene una pieza y una parcela de prueba; B compra ambas; A pierde
uso/permisos y B los obtiene una sola vez. Reiniciar servidor, perder una respuesta, repetir eventos,
intentar doble compra y simular caída de red/reorganización sin duplicados ni restauraciones gratuitas.
Revisar visualmente PC/móvil emulado; dispositivos físicos y publicación se registran aparte.
Los fixtures no convierten parcelas o equipo actuales de jugadores en tokens automáticamente.

W01 entrega identidad/operaciones de almacenamiento aisladas, sin registrar automáticamente activos
actuales, proyectar propiedad al gameplay ni vincular tokens. [Contrato W01](docs/briefs/w01-asset-registry.md).
W00a tiene ambas modalidades de equipo elegidas y contrato de contenido aislado; derechos de pérdida,
licencias, economía y reglas de escritura siguen abiertos. [Reglas](docs/briefs/w00-equipment-rules.md).
W00 puede redactarse en paralelo. W03/W04 necesitan persistencia y transferencia del alcance que usen
verificadas de extremo a extremo; bienes sujetos a muerte/saqueo requieren además el ciclo durable M5.
W04 no exige haber terminado W03, pero ambos comparten identidad/custodia/recuperación.
La prioridad relativa frente a construcción/naval/agentes se acuerda al incorporar cortes a la cola;
este plan no cambia esa cola ni degrada el pilar de agentes ya acordado.

## 7. Siguientes decisiones concretas

**Secuencia inmediata W02:**

1. W02i (contrato/artefacto) y W02j-a (preparación offline) aceptados localmente. No leer claves ni
   enviar transacciones desde sus comandos. El reporte no acredita red ni configura gas/nonce/fees.
2. Herramienta W02j-b aceptada localmente (97/97), sin corrida pública. Ejecutarla con direcciones
   públicas de deployer/operador, RPC y límite de simulación explícitos; comprobar runtime, bloque/red
   y estimación. Después revisar wallet de firma/recipient, fondos de prueba y presupuesto acotado
   antes de envío W02j-c; el gasPrice observado no autoriza gasto ni cotiza mainnet/USD.
3. W02j-c, con firma/envío y recibos exitosos: guardar dirección de contrato, chain, hashes de transacciones y bloques;
   comparar runtime usando referencias inmutables y verificar metadata/interfaz. Acuñar y transferir
   un token de prueba; leer dueño inicial/actual por hashes, incluido rechazo de hash desconocido y
   respuesta perdida. No reemitir automáticamente una transacción incierta.
4. Aceptar por separado Supabase live, origen HTTPS, extensión/firma/vínculo de cuenta y proveedor
   operativo. El éxito del lector NFT no acredita el flujo cuenta/wallet ni concede permisos jugables.
5. Antes de W03/W04 cerrar derechos/pérdidas/custodia y vínculo único token/activo; definir proyección,
   reservas, confirmación y recuperación frente a reorganización. Mantener gameplay sin wallet.

**Decisiones de producto aún abiertas:**

1. Equipo: ya se eligieron ambas modalidades. Cerrar permanencia de licencia visual, pérdida de instancia,
   reparación/destrucción y condiciones de adopción de una pieza generada por el servidor.
2. Tierra: ¿derecho permanente o concesión? ¿Qué incluyen venta/mantenimiento/abandono y cambios de mundo?
3. Custodia: ¿aceptamos depósito contractual mientras se usa el activo y retirada tras desactivarlo?
4. Economía: ¿qué se consigue jugando, límites de propiedad/tirada, precios y comisiones?
5. Red elegida: Polygon PoS, piloto Amoy. Concretar origen/proveedores, wallet, pagos, presupuesto de gas
   y orden de implementación; verificar el piloto antes de producción.

Las respuestas fijan W00a y su brief; no presentar las recomendaciones de este documento como decisiones
del autor. **Entrega actual: base de registro W01 y contrato de contenido de ambas modalidades
implementados y verificados localmente; vínculo cuenta/wallet por firma EOA en backend HTTP opt-in
y panel de navegador con proveedor simulado; montaje normal configurable, apagado por defecto,
con comprobación de prerrequisitos SQL antes de escuchar, diagnóstico independiente SQL/RPC del piloto
y lectores ERC-721/ERC-1155 en bloque explícito, ensayados contra bytecode EVM local; diagnóstico
RPC de Amoy consultado en red pública sin gas, contrato experimental preparatorio W02i y datos
de despliegue offline W02j-a y herramienta W02j-b de simulación/estimación verificada localmente,
sin corrida pública/firma/envío. Dirección futura W05 modular guardada; sin editor/recetas.
Extensión real, lectores contra NFT público, Supabase live, mercado jugable
y pagos todavía pendientes, sin publicación.**
