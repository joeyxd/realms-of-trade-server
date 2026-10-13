# Veta de los troncos recogibles — 2026-10-13

El autor detectó que la textura parecía girada. La proyección de caja elegía su
eje a partir de normales suavizadas por vértice: dentro de un mismo triángulo del
tronco curvo podía cambiar entre Y y Z y deformar la veta. Además, el recorte de
muelle de 23 píxeles estiraba parte de un nudo sobre toda la sección del tronco.

La geometría de recogida separa las costuras UV y calcula una proyección por cara,
con U longitudinal en los laterales y proyección transversal en las tapas. Después
restaura las normales de iluminación originales. Un recorte propio de madera limpia
del mismo atlas hace la veta longitudinal legible. El atlas, balsa, muelle, posiciones,
colores y triángulos originales se conservan. No se añaden texturas ni draw calls.
El tronco mantiene 96 triángulos; sus 54 vértices indexados pasan a 288 vértices
compartidos entre todas las recogidas, para permitir las costuras UV.

Validación local: 34/34 pruebas de recolección, GLB reales, madera de muelle/balsa y
recursos GM. La regresión del GLB comprueba posiciones, normales de iluminación,
fuente intacta y proyección coherente dentro de cada triángulo lateral.
Chrome local 2/2: escritorio 1280×720 y móvil emulado 844×390; atlas real 1024/512,
UV dentro del recorte, U longitudinal y cero errores. Capturas inspeccionadas:
[antes](local/desktop-before.png), [después](local/desktop-after.png),
[móvil](local/mobile-after.png). [Datos](local/evidence.json).

Reproducir: `node tools/qa-pickup-wood.mjs`. El harness crea un host de memoria
aislado y una copia cosmética temporal; no escribe inventarios ni mundo público.
Las capturas antes/después usan la misma malla, material y cámara, cambiando solo
las UV. Se conservan los originales GLB y la textura del autor.

Preparado para alpha.69, protocolo 61 existente. Publicación pendiente de confirmar
revisión activa, salud y entrada pública tras el actualizador habitual.
