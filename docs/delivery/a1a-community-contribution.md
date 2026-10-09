# A1a — primer contrato de aporte comunitario

2026-10-08 · módulo aislado de servidor, probado localmente · sin montaje en partida.

El aporte debita exactamente lo aceptado de la mochila del personaje, acredita la misma cantidad al proyecto y conserva un recibo del resultado. Se limita a lo que todavía falta; nunca cobra el exceso solicitado. Conserva el perfil completo y los requisitos iniciales del proyecto. Cada aceptación avanza las revisiones de personaje/proyecto y, si existe, la revisión comercial del perfil.

La operación identifica mundo, época, personaje y proyecto; un mismo UUID no se puede usar en otro ámbito. Un replay exacto devuelve el resultado original, incluso si después cambia el proyecto. Un rechazo válido también es terminal: no puede convertirse en éxito al reintentar. Una solicitud mal formada no reserva un ID.

## Implementación y comprobaciones

- `server/community/contributionContract.mjs`: campos cerrados, UUID canónico, cantidades/revisiones acotadas, catálogo `GOODS`, estado de proyecto validado y delta determinista. Un bien por operación.
- `server/community/memoryContributionStore.mjs`: carga de copias independientes; preparación de todos los resultados antes de la frontera sincrónica de débito/crédito/recibo. `durable:false`; no ofrece persistencia ni recuperación tras caída.
- `tests/community-contribution.test.mjs`: **17/17**. Conservación del perfil y materiales, exceso limitado, dos donantes disputando el último material, revisiones obsoletas, replay tras otro aporte, rechazo que después sería asequible, colisión global de ID, aislamiento de claves por mundo/época, agotamiento de revisiones y copias defensivas. Una bodega/carga en tránsito no financia el aporte.

```powershell
node --test tests/community-contribution.test.mjs
node --check server/community/contributionContract.mjs
node --check server/community/memoryContributionStore.mjs
```

## Límite y siguiente corte

No hay función jugable nueva todavía. El caller de servidor debe resolver identidad, permiso y acceso físico; el módulo no lo demuestra. No modifica host, sesiones, inventarios actuales, SQL, terreno, protocolo, cupo, recompensas, recetas, configuración ni arte. No fija costes finales de la Carpintería. Las copias privadas de perfil/recibo no se publican en una UI pública.

Sigue **A1b: transacción durable de personaje/proyecto/recibo y recuperación**, coordinada con M5 y el aislamiento por mundo/época. Necesita probar CAS, respuesta perdida y reinicio del proceso/backend antes de conectar el proyecto/tablero. Después: anclas de recepción, artesano, aprendizaje guardado y una primera pieza nueva usada en la balsa. Bodega como fuente requiere su propio permiso/acceso y conservación; no se conecta implícitamente.

La revisión de reutilización del [brief](../briefs/a1a-community-contribution.md) confirma que este contrato no necesita arte. Caja/banco y materiales del pueblo quedan como candidatos para el montaje visual posterior, sin tocar fuentes Unreal ni importar assets.
