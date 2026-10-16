# PRG02b — primer hito de pilotaje

Contrato de la primera competencia permanente de AREA07, 2026-10-10. Extiende la lección costera de [PRG02a](prg02a-coastal-lesson.md) con el sistema común de aprendizaje y una respuesta de timón mejorada. El cambio concede un solo hito de perfil; no añade recompensa consumible ni práctica incremental.

## Experiencia y elegibilidad

La lección mantiene las dos boyas en orden, la maniobra detenida y el regreso al puerto. El hito solo se concede cuando el servidor acepta la acción normal **Amarrar** y el intento está en estado `returning`. Atraque temprano, cancelación, costa, casco inutilizado, timeout, desembarco, recuperación o una afirmación del cliente no conceden aprendizaje.

El hito `pilot_coastal` se añade una sola vez a la progresión del perfil. Al aprenderlo, el rango de pilotaje pasa a II y la respuesta del timón usa un multiplicador de torque de `1.15` (15% sobre el valor base). La mejora se aplica tanto con balsa vacía como cargada; la carga conserva su efecto físico ordinario. Repetir la lección no concede más hitos, práctica, XP, bienes ni moneda.

## Perfil, confirmación y autoridad

- **Autoridad:** `NavalLesson` solo otorga el hito desde la terminación por atraque aceptado en `NavalPilot`. El cliente recibe el snapshot de aprendizaje y no puede enviar el resultado ni pedir el hito directamente.
- **Compatibilidad:** perfiles con progresión v1 conservan exactamente su forma al leerse y no se reescriben por defecto. El primer hito naval eleva únicamente ese perfil a v2, conservando práctica de Tala, hitos existentes y conocimientos.
- **Persistencia:** `GameHost` fuerza el guardado del perfil por la ruta normal de `ProfileSessions` y su CAS M5. No hay operación económica, cambio de mundo ni SQL nuevo. El snapshot distingue `local`, `pending` y `saved`; solo la sesión cuyo perfil confirmado contiene `pilot_coastal` comunica `saved` cuando el store declara durabilidad.
- **Fallo y recuperación:** un error o respuesta ambigua de guardado bloquea y cierra la sesión; no se presenta como guardado confirmado. Al reingresar, el perfil canónico resuelve si la fila llegó a confirmarse. Una caída antes de confirmación puede exigir repetir la lección. Este corte no promete cero pérdida para una recompensa aún no confirmada.
- **Red y física:** el snapshot de lección incluye el resultado de aprendizaje y persistencia; revisar y fijar `PROTOCOL_VERSION` junto con el cliente. El multiplicador solo escala el torque de timón en la navegación autoritativa y su predicción; no cambia masa, carga, vela ni autoridad del piloto.

## Alcance y dependencias

Se reutilizan el perfil común, `ProfileSessions`, los candidatos de cuerpo naval, las boyas procedurales y la tarjeta/HUD de PRG02a. No se necesita arte nuevo. La revisión acotada de Unreal señaló `NS_Spline_WaterSplash` como referencia cercana de agua, pero no aporta un marcador de instrucción legible ni requiere un puente para esta entrega; se mantienen las boyas actuales.

No incluye concesión de práctica de Tala, recetas, premios económicos, XP por navegar libre, persistencia de intentos ni garantía de recuperación sin pérdida ante caída previa al CAS. La técnica aprendida sí se aplica a los viajes normales desde el siguiente embarque, con o sin lección activa. La QA de navegador usa almacenamiento efímero y evidencia el estado `local`, no durabilidad pública. El control del multiplicador en dispositivo físico y la aceptación de navegación humana quedan pendientes. Publicación y despliegue se registran en la entrega.

## Validación prevista

- Pruebas de contrato de progresión: forma v1 exacta, grant v2, set-add idempotente, datos inválidos y versiones futuras rechazados.
- Pruebas de GameHost: boyas bajo control del servidor, atraque normal, guardado pendiente/confirmado, repetición, reconexión, respuesta ambigua y preservación de bienes/práctica.
- Pruebas de navegación: `1.0` frente a `1.15` de respuesta de timón con carga vacía y cargada; mantener intacto el contrato físico de masa y maniobra.
- QA visual en escritorio, táctil apaisado y retrato; verificar el rótulo ES/EN, estados de persistencia y ausencia de desbordamiento.
