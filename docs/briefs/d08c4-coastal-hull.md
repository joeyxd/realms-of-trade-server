# D08c.4 — contacto costero y casco en el puente local

2026-10-07. Siguiente corte autorizado tras D08c.3. Implementación y aceptación se registran
por separado en la entrega; este contrato no activa viajes públicos ni pérdidas durables.

## Resultado buscado

En `PROBAR-PILOTAJE.cmd`, alcanzar terreno o muelle frena/rebota ligeramente y permite deslizarse;
el golpe perpendicular fuerte daña la instancia flotante que chocó. El casco agregado resume esas
instancias. Un bloque a cero desaparece del cuerpo operativo y la cubierta, pero permanece en el plano.
Nave y ocupantes conservan una sola pose y autoridad después de recalcular el centro de masa.

## Contrato de geometría y tick

- `coastGeometry.js` genera polígonos convexos locales, por celda del heightfield existente. Recorta
  sus dos triángulos al umbral 0.15 m con margen `abs(h00-h10-h01+h11)/4`: envolvente conservadora
  de la altura bilineal de gameplay. No inventa nueve rocas del laboratorio como costa de toda la isla.
- Muelle orientado real y borde técnico a `map.half - 2` comparten la consulta espacial. Generación
  perezosa/cache por mapa; consulta de hasta 128 m por eje y resolución validada, sin reloj/RNG nuevo.
- Cada cimiento vivo usa su rectángulo, sin el círculo agregado que bloquearía huecos junto al muelle.
  SAT barre su traslación; el cambio de yaw usa una envolvente de orientación media y trayectoria
  curva de su centro. El margen crece con el giro: es conservador, no física exacta de sólidos.
- Hasta cuatro contactos por cuerpo/tick; al agotar el presupuesto, detener en la última pose separada.
  No aceptar un tramo restante sin comprobar. Velocidad del punto incluye rotación. Coeficientes
  experimentales existentes en `navalDamage.js`; no fija política de pérdidas ni balance final.
- Un contacto asigna daño a su instancia original, una vez por tick. No redistribuir exceso ni volver
  a dañar por una unión de triángulos. Recalcular rig conservando el origen mundial.
- `NavalTrial` prepara candidatos de todos los cuerpos antes de confirmarlos. Impactos de feedback
  sólo tras ese commit, privados para dueño/tripulación; predicción/replay no emiten efectos.
- Predicción construye la misma geometría del mapa/seed local. Contexto privado de costa validado,
  inmutable durante un epoch; snapshots de las dos corrientes se aceptan de forma conjunta.
- Protocolo 19: cuerpo con contactos del último tick, contexto de costa, casco/HP de piezas públicos
  durante el ensayo. Sin comandos de daño ni confianza en velocidad/propiedad enviadas por clientes.

## Cubierta y conservación

Pérdida de soporte de un pasajero lo devuelve al muelle; los demás siguen a bordo. Pérdida de soporte
del propietario o de toda flotación termina ese ensayo y rescata ocupantes. No revive muertos.
Plano, HP guardado, bodega, materiales, producción y pose canónica del amarre permanecen intactos.
No es reparación, seguro, devolución de materiales ni otro barco concedido.

## Feedback y reparto

Luna mantiene archivos separados para geometría, pruebas de contactos/autoridad y harness visual.
El principal conserva diseño, solver, integración World/cliente/protocolo, evidencia y aceptación.
Reusar espuma/spray/audio de `tools/naval-lab`, atlas y crate existentes. HUD muestra HP agregado y
último golpe; escena de costa/muelle y botón de aproximación son fixtures locales del mapa real.

FAB verificado por Luna, fuentes intactas:

- `C:\Unreal\MyProject\Content\NiagaraExamples\FX_Weapons\Impacts\NS_Impact_Wood.uasset`
  (4,773,771 B), referencia de impacto; Niagara/dependencias no portados a Web.
- `C:\Unreal\MyProject\Content\_SplineVFX\NS\NS_Spline_WaterSplash.uasset`
  (5,381,446 B), referencia de spray; conversión y presupuesto sin verificar.
- `C:\Unreal\MyProject\Content\SlashTrailElemental\Resource\Audio\Water\SW_Water_Slash_01.uasset`
  (303,741 B), clip sin extraer/audicionar; contexto de combate, no seleccionado para el casco.

No nueva textura ni exportación Unreal para este corte. El audio sintetizado y pools móviles actuales
permiten conectar feedback sin conversión de Niagara ni descarga extra.

## Verificación y límites

Barrido de franja fina, yaw, rozar/safe speed, muelle/límites, daño/IDs/rebase y repetición determinista;
World/cliente, ACK/replay, heartbeat retenido M5, soporte roto, lifecycle y conservación byte a byte.
Inspeccionar capturas de choque y navegación en PC y móvil emulado. No convertir esa evidencia en
FPS, red WAN, audición humana o aceptación de dispositivo físico.

Siguiente: D10, viaje/encuentro acotado con rutas y NPC, tras delimitar los hooks públicos y custodia
que aún requieren M5. Drift/ancla, remolino, fragmentos físicos, reparación y PvP siguen separados.
