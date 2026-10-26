# Bucanero: idle en la ficha de personaje

2026-10-11. El autor pide reemplazar la postura rígida de la ficha por el idle que ya entregó.
Se reutiliza el clip `idle` del mismo GLB; la alternativa de una ilustración nueva no es necesaria.
El inventario Unreal/FAB no aporta un clip más fiel a este personaje que su animación fuente.

El corte conserva únicamente `idle` en los derivados 1024/512 (+353.260 B por variante).
La ficha usa una instancia del rig Mixamo original y un mixer independiente; el mundo conserva
el rebind y controlador de 15 huesos. Comparte geometría/textura ya descargadas, sin otra petición GLB.
Giro, zoom y tamaño de alpha.53 se conservan. Miniaturas muestran la pose inicial y movimiento
reducido conserva una pose quieta del idle; solo la figura principal anima, a un máximo de 24 FPS
y mientras está visible. El menú de ajustes también detiene el preview que queda detrás.

Verificar el loop completo, manos/pies y encuadre en escritorio/móvil, giro/zoom/reset, pausa al
cerrar, pestañas sin figura, documento oculto y movimiento reducido. Probar independencia de rigs,
clip nativo byte por byte y restauración del renderer ante una excepción. Sin SQL ni protocolo.
La publicación respeta el actualizador y las partidas activas; no se afirma FPS físico de móvil.
