# D08c.10 — Reparar el casco con materiales

Contrato local de desarrollo, 2026-10-07. Sigue a D08c.9. Autoría de autoridad/sim e integración: root;
UI, pruebas y revisión de navegador: workers GPT-6 Luna con un escritor por archivo y un navegador.

- La condición pertenece a la nave adjunta del servidor durante su sesión. Conserva HP e identidades
  al atracar, recuperar desde puerto, perder soporte y volver a zarpar. Blueprint e inventarios son separados.
  No hay daño durable entre desconexiones/reinicios; no activar riesgo económico público con esta limitación.
- Editor en puerto, dueño vivo/quieto y cerca de cubierta o pasarela del plano. Navegación o pasajero bloquean.
  Reparar exige índice/tupla, revisión, identidad de instancia y HP esperado exactos; precio y HP final son del servidor.
- Reparación completa de una pieza: por material `ceil(coste de construcción × fracción de HP ausente)`.
  Pieza a 0 HP requiere coste completo y reconstruye la misma instancia en su casilla del plano, sin insertar otra.
  Una pieza sana rechaza sin coste. Cifras iniciales, pendientes de balance humano.
- Clones/preflight de guardado/espacio físico/ocupantes preceden al único commit de materiales + HP + revisión.
  Bodega paga antes que mochila. Reintento exacto recibe el mismo ACK; UUID alterado rechaza.
- Retiro devuelve `floor(coste × 0.5 × fracción sana)`: cero por una pieza destruida. Refuerzo conserva
  fracción de HP, nunca cura gratis. Construcción/retiro no sana el resto ni renumera las instancias conservadas.
- El plano reserva todas las piezas; representación y geometría públicas contienen solo piezas vivas.
  Diagnóstico privado en `capacity.condition`; HP visible público reutiliza `hull/partHealth` existentes.
  Bodega legacy mantiene volumen nominal: no borrar carga si una caja se rompe. Porte/admisión usan piezas vivas.
- Materiales/revisión se guardan por el flujo firmado existente; condición es explícitamente de sesión.
  Protocolo 25 / alpha.10 por diagnóstico/recibos. Sin SQL ni publicación.

Reutilización: D06-REUSE identifica `SM_RepairBench.uasset` (101896 B) en Dreamrise_SMSK del proyecto
survival en `C:\Unreal`; no hay GLB ni dependencias exportadas/verificadas. No aporta ahorro inmediato
a una operación del editor. `BP_Holdable_BuildHammer` es referencia de UX/request, no lógica portable;
`SM_Hammer` no tiene vista/exportación aceptada. Reutilizar astillero, glifos y materiales existentes;
aplazar taller físico hasta exportación/inspección concreta. Fuentes Unreal intactas, cero texturas nuevas.

Aceptación: identidad y conservación de materiales, coste/replay/rollback, reparación de HP0, refits con daño,
montar/impacto admitido/atraque/reparar/remontar, autoridad, producción/carga con piezas ausentes;
revisión de UI en PC, móvil horizontal y vertical rotado. Fixture de daño interno no equivale a impacto visual
real en navegador, ni la emulación prueba FPS/audio/balance en teléfono físico.
