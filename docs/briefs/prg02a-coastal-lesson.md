# PRG02a — primera lección costera voluntaria

Contrato de la primera lección de pilotaje de AREA07, 2026-10-10. Continúa la ruta costera existente y precede al aprendizaje común PRG02b. La nueva regla de oscuridad de [AREA07](area07-night-visibility.md) se implementa después de que el jugador tenga una fuente de luz utilizable.

## Experiencia

La lección es opcional desde el timón de la balsa propia, cerca del amarre. Una tarjeta compacta permite alternar entre esta lección sin salvas y el ensayo naval de cañonera existente. No se fuerza el inicio ni se bloquean los controles normales de pilotaje. La tarjeta describe el paso actual y comparte la orientación al siguiente objetivo con la vista de navegación.

El recorrido tiene dos boyas de servidor y una llegada real al puerto:

1. Navegar hasta la boya de salida. La primera boya debe alcanzarse antes de evaluar la segunda.
2. Llegar a la boya de maniobra, dentro de 9 m, y mantener la balsa a 0,8 u/s o menos durante 45 ticks consecutivos (0,75 s). Si se sale del radio o se supera esa velocidad, el contador vuelve a cero.
3. Regresar al puerto y usar la acción normal **Amarrar**. La lección solo se completa cuando el servidor acepta ese atraque real.

Acercarse al amarre sin atracar, desembarcar, recuperar la balsa o informar progreso desde el cliente no completa la lección. Una cancelación, costa, casco inutilizado, timeout o atraque temprano termina el intento sin éxito. El jugador puede repetirlo mientras conserva la sesión.

## Autoridad y alcance

- `LocalServer` ofrece la tarjeta solo en navegación live. El dueño actual de la balsa debe estar al timón con la época vigente para iniciar o cancelar. Los invitados pueden observar la guía, pero no escribir progreso ni cancelar el intento del dueño. El pause y un tick bloqueado rechazan comandos.
- El cliente envía la acción y la época. El servidor cuenta boyas ordenadas y velocidad/posición del cuerpo candidato ya calculado; no acepta coordenadas ni estado de lección del cliente.
- La lección planifica sobre el candidato del tick naval y confirma su avance únicamente después de que todos los cuerpos de la flota hayan podido calcularse. Un fallo de tick no consume progreso. El ensayo de cañonera y la lección no se pueden ejecutar a la vez.
- Los intentos, cancelaciones y resultado viven en la sesión. Desconectarse los borra. No se agrega XP, rango, habilidad, materiales, botín, campos de perfil, tablas SQL ni crédito permanente de aprendizaje. PRG02b conectará aprendizaje al contrato común cuando esté disponible.
- La costa mantiene su daño de casco existente. La lección no crea enemigos, amenazas ni salvas.
- La vista reutiliza las boyas y primitivas procedurales de la ruta costera actual. La revisión de Unreal/FAB no identificó un candidato de boya o señal de navegación listo para importar; no se exporta ni agrega ningún asset.

## Verificación y límites

El checkout local reportó 219/219 pruebas seleccionadas aprobadas para este corte. La comprobación de frenado con física real parte de 4 u/s al llegar a la segunda boya: vacío se detiene a 0,8 u/s en 85 ticks y 3,32 m; con cuatro unidades de madera, en 112 ticks y 4,37 m. Ambas distancias caben dentro del radio de maniobra de 9 m y dejan margen para los 45 ticks detenidos. Es una prueba local de manejo, no aceptación de pilotaje humano.

La QA de navegador pasó en escritorio 1280×720, táctil 844×390 y retrato 390×844 con el escenario girado del juego: iniciar, cancelar, repetir, maniobra con indicador, regreso y atraque. Se inspeccionaron capturas representativas y se corrigió la tarjeta para que no tape el HP al girar el celular. Sin errores de página, consola, red ni desbordamiento. [Evidencia y capturas](../delivery/prg02a-naval-lesson/evidence-2026-10-10T16-36-41-045Z.json).

La fixture reposiciona cuerpos candidatos en el servidor para verificar flujo y UI; no demuestra que una persona pueda navegar sin asistencia. La regresión de navegador del ensayo de cañonera también pasó en escritorio tras seleccionar su tarjeta explícitamente. Dispositivo físico, rendimiento y recorrido humano quedan pendientes; publicación/despliegue se registran en la entrega.
