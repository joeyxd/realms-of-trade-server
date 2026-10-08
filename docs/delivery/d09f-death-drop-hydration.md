# D09f-2b.30 — restauración conjunta del suelo actual

Adaptador server-only aceptado localmente: deathDrops:true opcional en PearlGroundHydration/PearlStartup.
Recuperación, ambas lecturas y drain comparten una sola barrera. El lector pagina estado actual,
compara cada UUID/ordinal con loadDeathDrop y su recibo inmutable de muerte, y repite el scan completo.
La historia de creación no reconstruye botín picked/expired. Un intent sin recibo conserva reservas;
no lo reenvía automáticamente ni publica la muerte o recogida pasada.

Preparación solo lee; un drain síncrono instala perlas y después objetos/pociones con IDs locales
nuevos, conservando identidad durable, item canónico, coordenadas y plazos. Counter, tick, contenedores,
fuente preexistente o datos alterados dejan fence. Cancelación y fallo tardío del contador no instalan
un prefijo; rollback revierte drops/ledger propios. Getter/Proxy y Map sustituidos se rechazan sin
callbacks en modo combinado. La opción apagada mantiene el contrato previo de perlas.

Las ventanas ordinarias availableAt/expiresAt pasan intactas a pickAt/t: no se reinician ni se ajustan
al tiempo de carga. Suelo ground pasado de plazo permanece hasta su transición de gameplay autorizada.
No IO, RNG, mint, eventos históricos, perfil, recompensa, nueva migración o protocolo en drain.
Por familia se aplica maxRows; la suma se comprueba contra capacidad del contador seguro.

## Reloj y activación

Este corte prepara la restauración; no cierra el reloj durable ni activa el host. WorldState guarda
el reloj económico, no el tick de las fuentes. GameHost todavía rechaza deathDrops en mountPearlStartup;
conservar esa denegación evita aparentar que un reinicio con tick cero mantiene los vencimientos.
El caller del adaptador debe entregar un tick lógico ya estable. Las pruebas de nuevas autoridades
usan ticks explícitos antes/dentro/después de ventana; no son restart del servidor desplegado.
Segundo scan detecta drift observado, sin snapshot PostgreSQL entre páginas ni lease multiproceso.

## Evidencia local

**120/120** comprobaciones pertinentes en cinco archivos: memoria **102/102** (2.171,695 ms) y SDK/SQL001–012 **18/18** (16.475,8718 ms). Incluyen **51 nuevas**, sin sumar de nuevo las comprobaciones repetidas. Node v24.14.0; archive fijo de base 342c026f más las fuentes propias. Las 484 fuentes y los 954 archivos binarios de Three privado se comprobaron antes/después de ambas cohortes. SDK2.117.2 y PGlite0.5.8 por junction, sin hash completo de esas dependencias; copia sin .env.

Integración enfocada en checkout compartido: **33/33** (1.193,2915 ms), 765 fuentes vigiladas antes/después, sin drift. Un intento previo también pasó 33/33, pero detectó una edición paralela en tools/agent/network-client.mjs; se conservó ese log y se repitió la comprobación, sin tocar ese archivo. No acepta el conjunto de features paralelos del checkout.

El primer ensayo de los tres archivos nuevos pasó **51/51**, incluido SQL18, antes del manifiesto de vigilancia; no se le atribuye una comprobación pre/post de fuentes. Una pasada extendida candidata a 170 archivos pasó red **2/2**, pero su cohorte core quedó cancelada y no está aceptada. La segunda cohorte SQL pertinente venció su límite de proceso: tampoco está aceptada. Tras recuperarse la creación de procesos, el caso de paginación entre UUIDs pasó **1/1** y la cohorte SQL completa **18/18**, con fuentes vigiladas en ambos. No se atribuye una causa de entorno no diagnosticada ni una aceptación de regresión completa.

Fixtures usan journal/recibos reales en memoria y SDK contra PGlite. Cubren perlas/objetos/pociones, páginas a través de dos muertes, una lectura de recibo por UUID, picked/expired, plazos intactos, respuesta perdida, intención sin recibo, capacidad, cancelación, drift y rollback tardío de ambas familias. La recogida posterior pasa por DeathDropStaging y una nueva autoridad omite el origen recogido. Los ticks se proporcionan explícitamente: esto no prueba un restart desplegado.
[Evidencia y fuentes](d09f-death-drop-hydration-evidence.json).

Unreal/FAB verificado en solo lectura: BP_InventoryComponent.uasset, 24.878.603 bytes, y SM_Potion.uasset,
117.402 bytes, de ActionRPGMultiplayerStart. Blueprint/visual no aportan autoridad JS/PostgreSQL ni
reloj durable; se reutiliza gate/journal/DTOs/reader/apply existentes. Fuentes intactas, sin export/arte.

SQL010 aplicada según el autor. SQL011/012 real continúan sin confirmación/canario adicional en este
corte. No push, deploy, env ni reinicio. Sigue epoch/reloj de suelo y composición de startup en host;
luego aceptación real restart/reconexión/WAN. Afinidad permanente por personaje/tipo y P4/P6 abiertos.
