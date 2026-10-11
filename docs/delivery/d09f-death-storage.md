# D09f-2b.21 — storage de muerte completa

Base `2af53b8326570c0e87dbecae228b12a9779e2783`. [Contrato](../briefs/m5-death-storage.md).

La operación nueva confirma pérdidas y creación del botín en una sola transacción: perfil de víctima, PK del atacante en Cala, todas las perlas/ubicaciones y objetos/pociones en el suelo. Sirve también con cero perlas y sin botín. SQL009 y memoria verifican el baseline completo, el delta exacto y generaciones; el replay conserva el recibo histórico sin repetir EXP, PK ni drops.

Se conserva la regla del autor: perla tragada hasta morir; EXP y bolsa perdidas globalmente; equipo/pociones adicionales en Cala, con starter del mismo kit si se pierde el arma. Nivel, oro, maestría, tatuajes y economía permanecen. 10 % de EXP sigue provisional y ajustable.

`loadDeathOperation` recupera el recibo y `listDeathDrops` pagina por mundo/UUID/ordinal. Los drops pertenecen al request provisional exacto; una transacción no puede dejar recibo sin resultado o con perfiles/perlas/botín incompletos. RLS/RPC service-only, namespace común contra recibos/journal antiguos en ambos sentidos e invariantes antes del return y diferidas al commit. SQL001–008 intactas.

## Aceptación

Regresión final **1227/1227**, 97 archivos y 333 fuentes fijas, Node v24.14.0: 2/2 de red aislada (concurrencia 1, 6560,345 ms) y 1225/1225 core (concurrencia 2, 72086,643 ms), 78646,988 ms sumados. Base anterior 1166/1166; este corte añade 61 checks en cuatro archivos de pruebas. Archive Git de la base más once overlays propios, sin cambios ajenos ni .env. Salida normal, sin --test-force-exit.

Dirigida final **68/68**, cinco archivos, 26539,2531 ms: cuatro nuevos contratos y el servidor del laboratorio. Corresponde a las mismas fuentes finales que la regresión. La dirigida anterior de 197/197 es histórica y no sustituye esta aceptación.

Fuentes de proyecto/migraciones/tests verificadas por SHA-256 LF antes y después de cada cohorte, y overlays propios comparados con el checkout. Fuentes restantes iguales al artefacto aceptado anterior. Dependencias: Three.js 0.160.0, PGlite 0.5.8 y Supabase JS 2.117.2; Three.js copiado dentro del archive para satisfacer el realpath del laboratorio, otras dependencias instaladas por junction. Los 954 archivos de la copia de Three.js y las versiones se reverificaron al cerrar la aceptación.

[Red aceptada](../../shots/review/m5-death-storage-network-accepted.log), [core aceptado](../../shots/review/m5-death-storage-core-accepted.log), [dirigida final](../../shots/review/m5-death-storage-directed-directed.log) y [evidencia JSON con hashes/comandos](d09f-death-storage-evidence.json).

Tres procesos Node nuevos verifican commit con respuesta perdida, lectura de perfiles/perlas/drops desde disco sin dispatch y replay sin doble pérdida/botín. Cuarenta y cuatro combinaciones de EXP/fracción se comparan con el helper real; Cala prueba armas sable/pistolas y starter conservado. Muertes de nueve perlas con generaciones distintas, baseline viejo incluso con misma versión, delta/corrupción de provider, scopes/páginas, colisiones de UUID y guards de writes directos. Cinco fallos inyectados después de escribir parte del segundo perfil/UID/drop o al cerrar el recibo revierten todo y permiten retry con el mismo UUID.

## Corridas anteriores descartadas

- Smoke de construcción detectó un CASE sin paréntesis y la prueba de precisión detectó mi suposición incorrecta de Float32. El ECS real usa Float64; corregido antes de la aceptación aislada.
- Un probe adicional detectó `xpBefore=0.004999999999999999`, fracción 0: el helper real deja 0, pero `floor(x*100+0.5)` en SQL lo rechazaba. Se cambió a comparación de parte fraccionaria, se añadió el caso a la matriz y se verificó en SQL/memoria.
- Primera regresión completa: 1224/1225 core, fallo 404 en Three.js del laboratorio. El archive usaba una junction de todo node_modules y el servidor rechaza rutas reales fuera de su raíz. Corregida la preparación según la aceptación anterior, sin cambiar servidor/tests/assertions. [Salida rechazada](../../shots/review/m5-death-storage-core-rejected-junction.log), SHA-256 `c3c312d80a068528daf066a2ad63aef5bef9a3553895d904f567643b50aee25a`. Primera dirigida 197/197 sobre la versión anterior queda supersedida por las fuentes finales.

## Revisión y reutilización

GPT-6 Luna hizo auditoría de storage/namespace, autoría exclusiva de cuatro archivos de contrato y revisión independiente posterior, incluido el redondeo. El principal escribió DTO/SQL/store, pruebas de precisión/restart/provider, revisó código y aceptó la evidencia con hashes. Sin aceptación basada solo en reporte del worker.

Reverificados inventario Unreal/FAB y fuentes intactas: BP_JigServerSave 580.554 B, BP_InventoryComponent 24.878.603 B; no portables a Node/CAS. Se reutilizan captura real, saneado y ground/invariantes de perlas. Sin assets nuevos ni cambios en Unreal.

## Límites y siguiente paso

**SQL009 está preparada; no aplicada ni verificada en Supabase real.** Aplicar después de 001–008; después verificar en el proveedor. Sin env/secrets, push, deploy ni reinicio del host del PC. Protocolo sin cambios; los tests usan la base fija de protocolo 19, mientras el checkout compartido lleva trabajo ajeno fuera de esta aceptación.

**No está conectada la muerte durable a la partida activa.** Falta diario/cola de esta familia, reservas previas al await para víctima/PK/UID, progreso previo asentado bajo reserva, lifecycle death/respawn, apply síncrono y publicación, pickup/consumo de botín, hidratación/expiry/retorno y epoch/reloj/leases. `listDeathDrops` lista filas de creación; no prueba suelo actual recogible hasta resolver esos estados. No recuperar eventos históricos ni rebobinar RNG.

Afinidad por personaje/tipo permanece confirmada pero no implementada. Su prueba de conservación SQL de JSON futuro no añade esquema/progresión al SDK. Finalizador y P4/P6 siguen parciales. Siguiente slice: diario/cola de muerte y recuperación exacta sin apply/eventos tardíos.
