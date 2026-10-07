# D09f-2b.8 — reconstrucción de suelo sin replay de gameplay

2026-10-06, base `e1aa918`. [Contrato y reutilización](../briefs/m5-pearl-ground-hydration.md).

## Resultado

`PearlGroundHydration` reconstruye drops y ledger desde ubicaciones gestionadas actuales, antes
de admitir cuentas. Una barrera opaca de la autoridad común impide todas las nuevas lanes durante
la paginación, incluyendo UIDs aún no descubiertos. Exige diario recuperado, scope coincidente,
cero sesiones/tasks y ninguna operación o reserva pendiente. No libera un pendiente sin recibo.

Valida todas las páginas, unique holder:null/kind/generación y ubicación exacta. Un segundo scan
detecta cambios persistentes detrás del cursor. Límites configurables fallan al excederse sin truncar
la lista. El caller debe convertir explícitamente availableAt/returnAt; conserva coordenadas y
filas vencidas, sin escoger envejecimiento offline ni devolverlas/reubicarlas automáticamente.

`start()` solo lee/prepara. `drain()` síncrono comprueba tick, perfiles vacíos, identidad/contenido
ordenado de maps y contador; valida el plan entero antes de escribir. Asigna IDs locales nuevos y
conserva drops/ledgers ajenos. Instala drop/ledger/counter juntos sin loot/pearlChanged, RNG, mint,
save, nombres ni entidades históricas. Repetir drain exitoso no crea otro drop.

Fallos después de insertar o mutar una fila revierten las escrituras propias y dejan startup cercado.
Los valores esperados se clonan antes de escribir, por lo que callbacks que mutan el ledger no cambian
la referencia de comparación. Las pruebas de fallos cuentan invocaciones para demostrar que llegaron
al write que falla; una alteración de World antes del apply se rechaza antes de instalar.
Un mapper asíncrono se rechaza; su promesa se maneja aunque falle para evitar un rechazo sin manejar
que termine Node. El caso se reprodujo en un proceso propio y quedó cubierto por ambos contratos.
Si una lectura paralela falla, se espera que ambas terminen antes de exponer el rechazo. Así el dueño
puede cerrar storage sin dejar un RPC vivo: la fixture SQL reproducía ese atasco; el probe exacto
termina con el guard nuevo y el contrato verifica espera, barrera y ausencia de cambios de World.

## Evidencia

**758/758** pruebas pertinentes, **95 nuevas**, 35 archivos, concurrencia 2;
cero fallos, cancelaciones, omitidas o TODO. 663 checks anteriores seleccionados + 46/46 memoria,
46/46 SDK/PGlite SQL001–008 y 3/3 checks de seis procesos frescos.

Git archive del commit completo `e1aa918498b3917fade37d31c897f857018a7c31` más siete fuentes propias, junction de
dependencias y sin `.env`. SHA256 normalizados LF de las siete fuentes y 72 fuentes/tests
seleccionadas intactos antes/después; los anteriores coinciden con la base. [JSON](d09f-ground-hydration-evidence.json)
conserva comando, archivos, hashes, exclusiones y duración. Log local ignorado: `shots/review/m5-ground-hydration-accept.log`.


El contrato compartido cubre paginación, holder/version/location, segundo scan, respuestas inválidas,
errores de lectura, mapa de reloj requerido, overflow, IO lento y entradas/commits/snapshots bloqueados
antes de dispatch. Incluye ambos coordinadores, diario sin recuperar/pendiente, sesión viva, cambio de
tick/maps/counter/perfil, colisiones reales de UID/ID, mapas ajenos y rollback tras drops/segundo ledger.

Seis procesos Node frescos exportan/importan imágenes reales de Postgres SQL008: preparar death o
replace y cortar después del commit/antes del cierre del diario; reconstruir solo suelo/perfil actual;
pickup posterior; volver a reconstruir sin resucitar el tombstone. Adjuntar el perfil real conserva
sus perlas/progreso, no añade eventos históricos y el ledger impide reclamar suelo con una bolsa obsoleta.
Esto verifica reconstrucción de datos y recuperación de diario; no acredita restart de GameHost,
durabilidad de NodeFS ni escritura del adaptador contra Supabase live.

La fixture NodeFS inicial excedió 45/120 s antes de invocar el adaptador. Por ese límite, cuatro
runners anteriores de procesos/canario NodeFS no se repiten en esta aceptación; sus fuentes/hashes
se conservan y sus checks históricos no se suman al resultado actual. El JSON enumera los archivos
excluidos y el baseline pertinente. Las imágenes SQL evitan esa inicialización para la prueba nueva.

GPT-6 Luna escribió/revisó el contrato memoria/SQL; el principal revisó runtime y pruebas, corrigió
la comparación de maps para que la inyección alcance writes y ejecutó la aceptación aislada.
Blueprints ActionRPG comprobados por ruta/tamaño, sin código Node portable. DTO/scan, diario/gate,
World/inventory y backend de prueba propios reutilizados; fuentes Unreal intactas y sin arte nuevo.

## Alcance y continuación

Dos módulos runtime: gate y adaptador nuevo. Sin SQL/env, cambios de host/LocalServer/sim/cliente/
protocolo, publicación o reinicio. El trabajo naval/arte paralelo permanece fuera del corte.
El adaptador sigue dormant; su barrera no conecta los hooks ni protege escritores de otro proceso.
El segundo scan no es un snapshot SQL ni un lease; mantiene el requisito de una autoridad por mundo.

Sigue integrar startup y los [hooks completos](../briefs/m5-pearl-common-gate.md) con dueño exclusivo:
mantener simulación/admisión detenidas hasta drain, publicar drops actuales por snapshot y resolver
scope/namespace, reloj, adopción/invitados. La muerte completa también conserva equipo/oro/mundo,
además del spill pearl-only. P4/P6 siguen parciales.

Afinidad permanente por personaje/tipo conserva su requisito separado: pérdida o transferencia no
borra ni presta aprendizaje. Este corte no añade ese campo, crédito, curva, mejoras ni UI de afinidad.
