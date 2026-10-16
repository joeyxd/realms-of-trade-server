# D08c.9 — porte operativo y refuerzo del casco

2026-10-07. Implementación local **0.6.0-alpha.9 / protocolo 24**; [contrato](../briefs/d08c9-raft-load-limits.md).
Checkout compartido: este informe describe el corte naval, no acepta ni publica los otros cambios del árbol.

## Comportamiento

La balsa ya tiene un límite operativo: mínimo entre resistencia estructural acumulada y 90% de flotación
viva. Cuenta piezas equipadas, bienes de bodega, mochila del piloto y mochilas de invitados consentidos,
además de 3 uM por persona. Bodega y editor distinguen masa uM de espacio uV. Desde 85% aparece pesada;
un zarpe nuevo excedido se rechaza antes de crear un viaje, sin consumir ni quitar bienes.

**Reforzar** selecciona un cimiento básico y sustituye esa pieza en su casilla, con confirmación explícita:
1 madera + 1 hierro, bodega primero y mochila después. Obtiene cinchas adicionales, 90 HP frente a 60,
14 uM de estructura frente a 10 y pesa 5 frente a 4. No añade flotación. El costo total de la pieza es
5 maderas + 1 hierro; retirada mantiene la regla de devolución parcial. Clones/preflight/revisión/recibo
protegen pago y sustitución; repetir el recibo no cobra ni duplica la mejora.

| Balsa inicial, sin mercancías, piloto incluido | Porte de bienes |
|---|---:|
| Cuatro cimientos básicos | 16 uM |
| Un cimiento reforzado | 19 uM |
| Cuatro cimientos reforzados | 22,4 uM |

La mejora se frena al alcanzar el desplazamiento seguro. Más cajas solo aportan espacio y peso; para
transportar más hay que ampliar casco o reforzarlo. Cifras iniciales para calibración, no balance aceptado.

El depósito y la producción no pueden aumentar el exceso de la bodega con reserva del piloto. Suministros
del editor ocupan bodega hasta sus límites de masa/espacio y luego mochila. La mochila personal puede
comprar/recoger en tierra; redistribuir mercancías entre mochila/bodega no reduce el peso de zarpe.

Los invitados tienen admisión por peso y cerco de cambios económicos a bordo. Su masa agregada se retira
al bajar; refrescar tripulación conserva pose, velocidades, tick, actividad y daño del casco. El centro de
masa interno se rebasa para conservar el origen del barco. El lastre de tripulación se sitúa en el centro
de las cajas en este corte; no hay todavía lastre humano dinámico al caminar.

Saves antiguos conservan todos sus bienes. Reembarque, atraque y recuperación siguen disponibles si daño
o recolección dejan la nave sobrecargada. La integridad/pose del viaje continúan siendo de sesión: no se
introduce reparación, persistencia de pérdidas, tiers ni habilidades de navegación en este corte.

## Reutilización y validación

Revisados los informes Unreal D06/D08 y la caja Dreamrise: no hay una pieza portable de refuerzo que encaje.
Se reutilizan atlas/material de hierro, bandas y pernos procedurales del renderer. Cero texturas o modelos
nuevos; `C:\Unreal` intacto. Los cimientos reforzados siguen la misma geometría de apoyo, timón y costa.

**344/344 pruebas pertinentes**: navegación/crew/predicción/contacto, casco, editor, renderer, comercio,
producción, recursos y reentrada. [Log](d08c9-raft-load-limits/regression-final.log). Incluye rechazo de
zarpe/carga, recibo/delta de refuerzo, preflight sin cargo parcial, mochila de invitado, lastre al entrar/salir,
regreso excedido por daño, conservación legacy y producción detenida por porte. No es la suite completa
de otros milestones del checkout.

**3/3 recorridos de navegador emulado pasados**, con capturas inspeccionadas: escritorio 1280×720,
touch 844×390 y touch 390×844 con stage girado. [Evidencia](d08c9-raft-load-limits/raft-load-limits-evidence.json)
incluye 18 capturas, cero errores de página/consola/red/HTTP en el pase final y confirmación real del refuerzo.
En cada vista el servidor rechazó primero zarpar con 45/40 uM; la mejora consumió exactamente madera/hierro,
cambió un solo cimiento en su sitio y dejó 37/44 uM. Perfil invitado firmado de 1.350 bytes restauró plano,
bienes y revisiones al reentrar; después aceptó el timón y mostró 7 uM libres en el HUD.

El inventario, posición junto al timón y cámara inicial son fixtures declarados de un host aislado con memoria;
no representan progreso ganado ni persistencia de cuentas/WAN. Las capturas de cubierta sin UI ocultan
temporalmente solo overlays y ghost de previsión. El primer pase encontró scroll incorrecto en móvil girado;
se corrigió con coordenadas del stage y controles compactos. Se conservan diagnósticos de ese fallo, una
suposición de masa del fixture, un selector sensible a mayúsculas y un fallo de reentrada con
`ERR_NETWORK_CHANGED`; la repetición final fue limpia.

Artefacto local generado desde el checkout completo, [build](d08c9-raft-load-limits/build.log):
272 archivos de paquete y HTML de 156.804 bytes UTF-8. SHA-256 del HTML:
`8296949e5425cd8a821d7427cac9817e98d62a541e6407b86314f88849960052`.
El paquete contiene también trabajo concurrente; la validación de este informe corresponde al corte naval.
No se ha actualizado la URL pública, hecho commit/push ni aplicado SQL. Teléfono/FPS físico, balance,
audición y aceptación humana quedan para el playtest conjunto del autor.

## Continuidad

Siguiente corte recomendado: reparación material del casco y lectura de piezas dañadas, con costo
conservado y sin duplicar módulos. Después persistencia de amarre/pose/daño y la primera amenaza de ruta;
no adelantar pérdida durable/PvP sin ese circuito de recuperación. Crafting por tiers y depósitos de puerto
mantienen su cola; echar mercancías al mar requiere suelo/recuperación autoritativa propia.
