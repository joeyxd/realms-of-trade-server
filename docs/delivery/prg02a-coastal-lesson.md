# PRG02a — lección costera voluntaria

Fecha: 2026-10-10. Implementación local **0.6.0-alpha.19 / protocolo 33**. [Contrato](../briefs/prg02a-coastal-lesson.md). Sin publicación, SQL o crédito persistente de aprendizaje.

Desde una tarjeta compartida, el capitán puede elegir la lección sin salvas o el ensayo de cañonera existente. La lección guía por dos boyas en orden: primero la boya de salida; luego frenar dentro de 9 m de la boya de maniobra y sostener 0,8 u/s o menos durante 45 ticks consecutivos (0,75 s). La guía cambia al puerto y el resultado solo llega tras usar la acción normal **Amarrar**. Atraque temprano, cancelación, costa, casco inutilizado o timeout no completan la sesión.

La autoridad `NavalLesson` y el snapshot v1 guardan estado solo en memoria. Iniciar/cancelar requiere dueño al timón y época vigente; el servidor verifica el cuerpo candidato y hace commit después de preparar los cuerpos de la flota. Invitados observan, pause/tick bloqueado rechazan comandos y la ruta de cañonera es mutuamente excluyente. Desconectar borra el intento. No hay cambio de XP, rango, perfil, materiales, economía o SQL; el ensayo no lanza salvas y mantiene las reglas de daño de costa. PRG02b queda pendiente de integración con el aprendizaje común.

**219/219 pruebas seleccionadas aprobadas**, incluidas autoridad live, protocolo, objetivos ordenados, atraque, cancelación/reintento y regresión de ruta naval. La comprobación local de frenado desde 4 u/s dio 85 ticks/3,32 m vacío y 112 ticks/4,37 m con cuatro maderas, dentro del radio de 9 m.

**3/3 vistas de navegador aprobadas:** escritorio 1280×720, táctil 844×390 y retrato 390×844 con el escenario girado del juego. Inicio, cancelación/reintento, selección de actividad, maniobra con indicador, retorno y atraque normal; guía ES/EN, sin salvas, XP/materiales/plano intactos, sin errores de página/consola/red ni overflow. Capturas representativas inspeccionadas; tarjeta ajustada según tamaño del escenario para no tapar HP al girar. [JSON y capturas](prg02a-naval-lesson/evidence-2026-10-10T16-36-41-045Z.json). El ensayo de cañonera anterior pasó su QA de escritorio después de seleccionar explícitamente la actividad.

La fixture de navegador reposiciona cuerpos candidatos y congela el reloj efímero solo para capturar el indicador intermedio; no demuestra navegación humana sin asistencia. Dispositivo físico y rendimiento quedan pendientes. Publicación y despliegue se registran después de verificar el VPS.

La presentación reutiliza boyas procedurales existentes. La revisión acotada de Unreal/FAB no encontró una boya o marcador de navegación listo para importar; no se importó asset nuevo.

Integrado sobre `b84c2da`, conservando las actualizaciones concurrentes de GM y continuidad de aprendizaje: **115/115 casos** de regresión integrada aprobados (incluyen perfil/Tala, continuidad GameHost/PostgreSQL local, lección, ruta, navegación, cuentas, economía y guardado de balsa). El bloque común de perfil ya se conserva; PRG02a todavía no escribe práctica naval ni concede una competencia.
