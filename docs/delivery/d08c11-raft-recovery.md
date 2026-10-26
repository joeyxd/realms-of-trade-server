# D08c.11 — el daño y la posición vuelven contigo

Fecha: 2026-10-08. Implementación local **0.6.0-alpha.11 / protocolo 26**.
[Contrato](../briefs/d08c11-raft-recovery.md). Sin publicación ni migraciones SQL.

Los perfiles guardan identidad, tupla y HP de cada instancia, incluidas piezas destruidas. Al volver
a cargar la partida, el astillero encuentra las mismas piezas y cobra la reparación según ese daño.
Plano, bodega, materiales, revisión y contador de nuevas piezas conservan su continuidad. Reforzar
mantiene identidad/fracción HP; quitar y construir de nuevo produce una identidad nueva.
Los límites de carga y la producción continúan usando módulos vivos después de reentrar.

La última pose confirmada de un viaje se guarda junto al seed de la isla. Si es segura, la balsa
reaparece estacionada allí; el personaje vuelve a su checkpoint. No reaparecen piloto, pasajeros,
invitaciones, velocidad, entradas, ACK, boosts ni enfriamientos. La UI ofrece reembarque cerca de una
costa válida o **Recuperar en puerto** desde el muelle. Esa recuperación mueve la misma entidad al
amarre derivado y conserva daño/carga; después se puede reparar y zarpar normalmente.
Atracar limpia el viaje guardado. Tomar el timón sin desplazarse conserva estado amarrado.

Se valida seed, valores finitos, límites de todo el plano, SAT de flotadores contra costa/muelle y
separación conservadora respecto de barcos presentes. Una pose incompatible, otro seed o ausencia
de flotación vuelve al amarre, sin sanar ni borrar mercancías. El estado de perfil antiguo sin
condición inicia sano como antes. Un registro de condición presente pero inválido conserva las
entradas válidas y deja las faltantes/malformadas a HP 0 en su casilla original, reparables con coste.
No hay comando de cliente que escriba pose/HP. El contador agotado rechaza la obra antes del débito.

La captura ocurre antes de publicar/guardar perfiles y antes de desconectar controles/nave.
El tick naval admite daño antes de escribirlo al perfil; daño pendiente de un tick rechazado queda
fuera del save. Transiciones navales aceptadas e impactos con daño adelantan el guardado existente.
Las cuentas conservan el guardado final/CAS del host; no se modificaron barreras M5, sesiones o SQL.

Reutilización Unreal/FAB: sin nuevos modelos, audio ni texturas. Se revisó la referencia ActionRPG
`SaveSystem/BP_JigServerSave`; no se porta a los contratos JS/HMAC/CAS. Se reutilizaron recuperación
de puerto, HUD, editor y geometría SAT existente. Fuentes `C:\Unreal` intactas. Auditorías,
pruebas y navegador por GPT-6 Luna; esquema/autoridad/integración/aceptación por root.

Validación final: **617/617 pruebas pertinentes** en
[regresión](d08c11-raft-recovery/regression-final.log), incluidas 12 nuevas de persistencia/lifecycle
y dos de ruta/UI. Cubren viaje admitido y daño real por el handle de simulación, guardado HMAC,
reinicio del host, cuenta/CAS en memoria, reembarque con velocidades cero/epoch nuevo, rechazo
de HP/pose del cliente, pose insegura/otro seed, reparación de casco destruido y tick bloqueado.

**3/3 recorridos emulados** — escritorio 1280×720, móvil 844×390 y vertical 390×844 con la rotación
del juego — pasan: SAVE firmado → reinicio/reentrada → recuperar desde puerto → reparación
con coste una vez → segunda recarga firmada. Mismo barco, piezas, carga y checkpoint; p1 30/60
antes y 60/60 después, dos maderas consumidas, viaje limpio. Cero errores de página, consola,
solicitudes o HTTP en el pase final. [Informe y capturas](d08c11-raft-recovery/README.md),
[JSON final](d08c11-raft-recovery/raft-recovery-evidence-2026-10-08T06-45-02-474Z.json).
Se inspeccionaron capturas finales de recuperación en las tres vistas y reparación móvil/reentrada.
Los primeros pases se conservan; la revisión visual detectó y corrigió el aviso de recuperación
oculto en touch. Daño/pose y traslado del personaje al muelle son fixtures declarados en navegador;
no se presenta ese recorrido como colisión real, rendimiento físico o aceptación humana.

Límites: el guardado periódico conserva su ventana actual; un cierre abrupto puede perder avances
posteriores al último save confirmado/recibido. Los blobs guest firmados antiguos siguen siendo
reproducibles y no prueban custodia durable más reciente entre hosts. El host desconectado retira la
nave del mundo: no existe todavía exposición offline. Recuperación de puerto sin coste es la política
del prototipo; no es balance de pérdidas/seguro/combate aceptado. No Supabase live, WAN, teléfono
físico, audición, FPS ni aceptación humana nuevos. D09/M5 mantienen las puertas de riesgo económico.

Siguiente: primera ruta/amenaza PvE naval acotada, con objetivo legible y recuperación explícita,
revisando assets Unreal antes de producir arte. No introducir pérdidas públicas permanentes con
blobs guest ni dar por completada la activación durable de M5.

Artefacto local `d08c11-raft-recovery/artifact.html`: página y estilos generados desde el checkout
compartido. JS/modelos/texturas se publican como archivos separados según `build.log`; esta página
no es un bundle autónomo ni una publicación. Incluye trabajo visual/chat/agentes ajeno a esta misión.
SHA-256 y bytes reales se registran en `artifact-meta.json`.
