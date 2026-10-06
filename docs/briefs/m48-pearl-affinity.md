# Afinidad de perlas — requisito confirmado, implementación pendiente

Confirmación del autor, 2026-10-06: el jugador aprende a usar las perlas, ese aprendizaje mejora su
poder y permanece cuando pierde la perla y cuando la recupera. Amplía M4.8 con persistencia M5;
no es un efecto de aplicar SQL 006 ni está implementado actualmente en perfil/combate/UI.

## Regla de juego

- La llave es **personaje + tipo de poder**: Brasa, Escarcha, Tormenta y Tinta tienen aprendizajes propios.
  El UID identifica el objeto que circula, no el progreso del jugador. Recuperar la misma perla u otra
  del mismo tipo usa la afinidad ya alcanzada.
- El uso válido progresa en afinidad/nivel y mejora la eficacia del poder. Curva/techo, crédito por acción
  y mejoras concretas requieren definir y probar balance; este contrato no fija porcentajes ni niveles.
- Perder, soltar, vender, prestar o morir con la perla conserva todo ese aprendizaje. Sin llevarla no
  aplica su poder; al volver a tragar una del mismo tipo, aplica el dominio conservado.
- Cambiar de tipo conserva el progreso anterior y usa el del nuevo tipo. Transferir la perla a otro
  jugador no transfiere afinidad: el receptor utiliza su propio aprendizaje.
- Mantener maldiciones y circulación. La regla aprobada no autoriza borrado/reset de afinidad por pérdida.

## Contrato técnico pendiente

Guardar el aprendizaje separado de `profile.pearls`: `spillPearls` limpia ese inventario al morir y
el ledger/recibo mueve objetos entre dueños. Defaults y `sanitizeProfile` deben conservar el campo nuevo
en perfiles anteriores, importación, save/load y reinicio; hoy el saneado elimina campos desconocidos.

El servidor acredita acciones válidas y calcula efectos con el aprendizaje del personaje. El cliente
muestra nivel/progreso y predice con datos confirmados; revisar protocolo al introducirlos. No acreditar
solo pulsaciones, recasts sin objetivo/desafío ni bucles ilimitados entre aliados. Definir la unidad de
crédito/idempotencia para que un reintento de comando/evento no conceda XP dos veces.

Las operaciones durables de perla conservan aprendizaje del dueño junto al resto del progreso;
la espera de CAS/apply no retrocede afinidad nueva. La hidratación carga tanto inventario como aprendizaje
actual sin repetir eventos históricos. Necesita dueño único de sim/perfil/UI al implementar, coordinado
con el trabajo naval; este brief no cambia runtime, fórmulas ni hooks compartidos.

## Aceptación

Demostrar uso válido→aprendizaje→mejora, tipo distinto independiente, pérdida/death/venta sin reset,
recuperación con el dominio previo y transferencia sin prestar XP. Guardar/cerrar/reiniciar/restaurar
conserva progreso; perfiles antiguos reciben defaults. Repetir una petición o recuperar un recibo no
duplica XP. Capturas de UI y comparación de poderes antes de aceptar la integración.
