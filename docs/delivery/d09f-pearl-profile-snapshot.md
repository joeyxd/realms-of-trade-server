# D09f-2b.14 — progreso canónico al confirmar perlas

## Resultado

Captura separada de nivel/XP/pociones/checkpoint actuales del ECS para el baseline y el apply de
staging. Conserva oro/equipo/maestrías/tatuajes/progreso del perfil, referencias ajenas y el delta exacto
confirmado de perlas. Transferencia conserva el progreso de cada dueño; reemplazo conserva la ubicación
y tiempos ya planeados. El apply encola el progreso reciente una vez, con rollback local y fence.

Adapter opcional con validación de configuración, sincronía, canon y campos permitidos;
el default conserva el comportamiento anterior. Puente `GameHost.capturePearlProfile` comprueba la
cuenta/conexión actual y permite lectura reservada sin publicar. Inyección explícita sobre host real
cubre apply durante pausa y publicación posterior al tick admitido.

[Contrato](../briefs/m5-pearl-profile-snapshot.md), [evidencia](d09f-pearl-profile-snapshot-evidence.json).

## Verificación

Regresión pertinente en archivo Git fijo `d47353bc4d0dd839288cf1e943f786df323163ae`, más cuatro overlays
propios (host, staging, helper y test). Node v24.14.0, concurrencia 2; **884/884**, cero fallos/canceladas/
omitidas/todo, **78.809,5273 ms**, 67 archivos, 199 fuentes con SHA256 normalizado antes/después.
Comando, fuentes y exclusiones están en la evidencia estructurada. Log ignorado:
`shots/review/m5-pearl-profile-snapshot-accept.log`.

15 pruebas nuevas de nivel superior, 29 checks con subcasos: lectura sin escrituras/alias, datos ECS
inválidos, callbacks async o sustitución de inventario/oro/identidad, baseline antes de continuación,
apply con progreso más reciente, transferencia entre dos cuentas, reemplazo memoria/SDK-SQL008,
save separado reservado, fallo después del recibo, rollback, death/revival/close/recycle, reentrada,
invalidación durante captura inicial y puente del GameHost durante pausa.

Las primeras fixtures asumían HP constante al cambiar de nivel y publicación inmediata ignorando
el throttle de perfiles. Se corrigieron para comparar el helper real de stats/HP y la publicación
normal con su ventana habilitada; no cambian las reglas del juego. Revisión independiente de lectura
sin defecto material adicional; aceptación final del principal sobre fuentes y pruebas.

No cambia UI/payload/assets: no se repite navegador ni se acepta rendimiento/sensación física. No se
lee env, consulta Supabase, reaplica SQL, reinicia/despliega o absorbe trabajo naval/visual paralelo.
SDK/SQL aquí usa transporte local PGlite; restaurar perfil en fixture no acredita restart real del host.

## Pendientes

La circulación durable del juego aún requiere montaje automático del host, scope/namespace/reloj/
adopción e inputs tras apply. Se conserva el hold completo del tick; no se implementa cola granular.
No activa startup/diario/comandos automáticamente ni cierra P4/P6.

El progreso ganado después del recibo se guarda con CAS posterior, no pertenece retroactivamente al
commit de perla. Antes de completar ese save puede perderse por crash: finalizador durable y muerte
completa siguen abiertos. Los callbacks trusted deben ser read-only; no hay rollback genérico de sus
escrituras ajenas. Invalidación durante captura mantiene el cerco para reconstruir autoridad.

[Afinidad permanente por personaje/tipo](../briefs/m48-pearl-affinity.md) sigue pendiente; este corte
preserva campos actuales, no añade aprendizaje de perlas ni cambios de potencia. Protocolo 16 intacto.

Inventario Unreal/FAB cruzado: BP_JigServerSave (580.554 B) y BP_InventoryComponent (24.878.603 B)
verificados intactos de solo lectura; sin runtime Node/CAS portable. Reutilización del helper existente
`syncProfile` y autoridad del repo; sin fuentes Unreal ni assets importados.
