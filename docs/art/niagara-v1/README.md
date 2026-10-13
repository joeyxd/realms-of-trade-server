# Derivados Niagara del taller

Las fuentes de `C:\Unreal` permanecen fuera del bundle y de solo lectura. El catálogo
completo identifica sistemas y aliases por clase y SHA-256; las miniaturas de los paquetes
son referencias estáticas. Ninguna de esas dos evidencias convierte un sistema en jugable.

## Representaciones y fidelidad

- **Componente de textura:** celdas del atlas que utiliza un renderer del sistema original.
  Conserva esa animación, pero no las otras capas, materiales, iluminación, trayectorias ni
  los tiempos del sistema. Una máscara blanca es una interpretación explícita de canales,
  no el color final de Unreal. El tiempo inicial del taller es editorial.
- **Captura de sistema:** secuencia ejecutada en Unreal desde una cámara, con activación
  única, pasos de simulación registrados y pausa durante las lecturas. Su adaptación 2D
  debe declarar cómo obtuvo color y transparencia. Un fondo negro convertido en emisión
  no acredita la opacidad de humo ni su composición sobre un fondo claro.
- **Adaptación 3D:** necesita portar partículas, materiales, geometría y movimiento,
  y comparar el resultado con Unreal desde varios ángulos. Sigue como trabajo independiente;
  una captura o componente no acepta esa fidelidad ni permite editar el número de partículas.

La meta del autor es conservar la calidad artística original. No usamos presets parecidos
para cubrir fuentes que aún no se pueden adaptar. El taller muestra la representación y
el estado real de cada efecto. «Base del adaptador» compara sus valores iniciales con el
borrador. «Original» permanece en Tromba; el taller no ejecuta un segundo motor Unreal.

## Incorporar un recurso

1. Obtener clase, hash original y cadena exacta sistema → renderer → material → textura.
   El propietario del renderer debe incluir el nombre completo del objeto y `:`; un prefijo
   como `NS_Fire` también puede coincidir incorrectamente con `NS_Fire_02`.
2. Extraer candidatos a scratch mediante `tools/extract-niagara-subuv.py`, o ejecutar
   la captura en una copia aislada de Unreal. Revisar secuencia, color, transparencia,
   encuadre y contexto. Los candidatos no se aceptan automáticamente.
3. Escribir una spec aceptada con límites conocidos. `tools/pack-niagara-flipbook.py`
   verifica el hash original y empaqueta una variante de escritorio y otra de móvil.
   Reemplazar archivos existentes exige `--replace-reviewed`.
4. Registrar solo las salidas revisadas en `src/editor/niagaraDerivatives.js`. Los
   sistemas que comparten componente reutilizan su atlas; conservan sus cadenas de origen
   y deben coincidir en hash de textura, cuadrícula, interpretación de canales y geometría.
5. Verificar ambas variantes en el taller real, el borrador independiente y la cancelación
   de cargas. Ningún documento puede introducir URLs, scripts, shaders ni campos nuevos.

Las celdas fraccionales se remuestrean con sus intervalos UV exactos, limitando los taps
bicúbicos a muestras de esa celda. Un atlas de 7×7 conserva sus 49 celdas; no se corta en
8×8. No reducimos la secuencia de 121 celdas de GroundFire a 64 para declararla convertida.
El empaquetado mantiene gutters transparentes entre frames. Solo se carga un atlas por
dispositivo/selección; se liberan las texturas y bitmaps al cambiar o cerrar.

Las secuencias previas de Impact Wood con reinicio por frame fueron retiradas de la
aceptación y del registro. Se conservan únicamente en scratch para diagnóstico. Los
originales exportados, frames completos y capturas fallidas tampoco forman parte del bundle.
