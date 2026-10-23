# Revisión de captura

`native-browser.json` conserva el recorrido con ANGLE nativo: 13 comprobaciones,
sin errores de página/juego. `native-desktop-en.png` se inspeccionó a resolución
original y contiene completos título, estado, etiquetas y valores. Una vista
reducida pareció recortar letras; no se confirmó ese defecto en el PNG original.
No se añadió otro parche de UI por esa previsualización.
Los recortes `native-text-crop.png` y `swift-text-crop.png` conservan los píxeles
de título, estado y personalidad completos en ambos renderizadores. El recorrido
final SwiftShader aprobó las 13 comprobaciones tras corregir la espera del helper.

El runner permite comparar SwiftShader de forma explícita. En ese ensayo se
detectó una carrera del helper de foco: contaba controles mientras la carga
asíncrona aún los deshabilitaba. Ahora espera el campo editable antes de contar;
el comportamiento de producción durante carga no cambió.
