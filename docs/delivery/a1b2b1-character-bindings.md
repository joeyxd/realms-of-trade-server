# A1b2b1 — personaje asignado y admisión verificada

2026-10-09. Implementado y probado localmente; primera parte de A1b2b, sin montar GameHost. [Contrato y límites](../briefs/a1b2b1-character-bindings.md).

## Cambio

El servidor carga el personaje asignado a la cuenta verificada en su mundo/época. El vínculo durable es inmutable y solo puede apuntar a una fila existente; cambiar dueño/personaje o reclamar uno ya asignado se rechaza sin sobrescribir. La admisión ignora claims de cliente, reserva antes de esperar al backend y vuelve a comprobar la identidad de conexión en acciones/publicación. Una conexión revocada no puede leer el perfil anterior ni recuperar sus permisos al reaparecer un contexto viejo.

Migración opcional comunitaria 003, contrato de vínculo, APIs memoria/SDK y `BoundProfileSessions` sobre A1b2a. Cierres solicitados dentro de publicación se difieren hasta terminar el drain; writes inciertos conservan reservas hasta resolver su request/recibo original. No inicializa/importa personajes durante join ni modifica M5, SQL001–013, perfil, protocolo, costes o terreno. Conserva alpha.16/protocolo 32.

## Evidencia

**82/82 pertinentes pasaron**, 0 fallos/cancelaciones/skips; 122,572 s. Son 62 casos comunitarios previos y 20 nuevos: siete de vínculo, ocho de admisión y cinco de autenticación/SQL/publicación. [Registro de evidencia](a1b2b1-character-bindings-evidence.json).

```powershell
node --test --test-concurrency=1 tests/community-contribution.test.mjs tests/community-contribution-sql.test.mjs tests/community-contribution-boundaries.test.mjs tests/community-contribution-coexistence.test.mjs tests/community-character-saves.test.mjs tests/community-scoped-sessions.test.mjs tests/community-scoped-sessions-sql.test.mjs tests/community-character-bindings.test.mjs tests/community-bound-sessions.test.mjs tests/community-bound-auth-sql.test.mjs
```

- Propietario único por scope, FK/existencia, replay, conflictos, aislamiento de mundos/épocas y JSON estricto.
- Permisos de servicio/públicos, inmutabilidad de filas, reaplicación con datos, respuesta perdida y reapertura limpia de disco.
- Resolver de cuentas real con `getUser` simulado: cuenta verificada contra claims falsos; invitados, anónimos y rechazo de autenticación.
- Admisión concurrente, cierre/carga tardía, revocación permanente de esa admisión, vista sin perfil previo, bloqueo de publicación y recuperación cerrada sin doble aporte.
- Cierre reentrante diferido y rechazo de callbacks async, junto a conservación/CAS/rollback y coexistencia previos.

Aceptación ejecutada sobre copia aislada del source confirmado más los archivos de este corte; el guardado de memoria excluyó adiciones de bootstrap que otro escritor trabajaba en paralelo. Se comprobaron los blobs preparados para commit frente a esa copia; no se acepta ni se incluye esa otra implementación. Ocho archivos JS pasan sintaxis y la entrega pasa whitespace.

PGlite y SDK de fixture locales, llamadas serializadas, proveedor Auth simulado: no acreditan Supabase/Auth reales ni scheduling entre conexiones PostgreSQL independientes. Reapertura limpia no prueba crash recovery de una petición pendiente. No hubo lectura/modificación de `.env`, SQL live, despliegue, reinicio del servidor ni QA de navegador por este cambio interno.

## Continuidad

La pertenencia queda guardada; la exclusividad de sesión sigue siendo de proceso. A1b2 todavía necesita provisión inicial con procedencia explícita, diario/startup cerrado ante writes inciertos, coordinación de perlas/muerte y mutations ECS, y elección de una sola autoridad de perfil en host. El publisher confiable debe ser síncrono/atómico, dejar estables los contextos Auth y revertir sus escrituras si falla. Después siguen receptor/tablero/artesano y aprendizaje de Carpintería. Decisión de reutilización Unreal en el brief; sin arte nuevo.
