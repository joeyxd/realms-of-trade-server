# D08c.12 — navegar tiene un objetivo y salvas que esquivar

Fecha: 2026-10-08. Implementación local **0.6.0-alpha.12 / protocolo 27**.
[Contrato](../briefs/d08c12-naval-route.md). Sin publicación ni SQL.

En el timón, cerca del amarre, **Probar ruta** inicia un ensayo opcional. La brújula guía
por tres boyas en orden; después señala el puerto. Volver y usar **Amarrar** completa
el circuito y muestra impactos, salvas esquivadas y HP perdidos. Atracar temprano,
desembarcar, cancelar o recuperar termina el ensayo sin éxito. El control de atraque
pasa a primer plano al llegar despacio, también en touch.

Una cañonera anclada apunta desde su posición real y lanza proyectiles en arco hacia
una marca ámbar fija. La marca avisa durante dos segundos: puedes cambiar de rumbo
o aprovechar corriente/ráfaga para salir de ella. El área de caída intersecta piezas
flotantes vivas del casco girado; un impacto daña una sola instancia. El barco-hogar
conserva plano y mercancía, y el daño se guarda/repara por el flujo anterior.

Tuning inicial: seis HP por impacto, hasta 24 HP por ensayo; esta amenaza no baja una
pieza del 50% de su HP máximo. La costa sigue con su daño previo. Hay texto de coste
antes de iniciar, sin botín ni XP. Cancelar corta esta amenaza de práctica; no fija
reglas de huida de futuros encuentros. La batería no es aún un barco móvil/destructible,
no tiene colisión naval ni abordaje y no se le puede disparar desde la balsa en este corte.

Autoridad: dueño/timón/proximidad/época; un invitado puede ver la ruta de su nave y no
iniciarla/cancelarla. Cliente no decide objetivos, hits, HP o progreso. Planes de ruta
y daño se calculan sobre candidatos y solo se confirman después de toda la flota.
Impactos de salvas tienen eventos propios; conservan el contrato de contacto físico
del cuerpo y llegan después del commit. Máximo dos proyectiles por ruta y cuatro
ensayos activos. Progreso/resultados son de sesión; desconectar los borra, conservando
condición/pose del último save confirmado. Perfil versión 1 sin campos nuevos.

Presentación: boyas, cañonera y proyectiles con geometría acotada, avisos con profundidad
del mundo, interpolación visual a 60 ticks/s y extrapolación limitada. Audio sintetizado
y partículas existentes; splash en la marca, respuesta de casco solo con daño confirmado.
Escritorio/touch comparten objetivo, coste, botones y resultado. Cero texturas nuevas.

Unreal/FAB: Luna verificó `BP_ZombieAI`, Barrel, `NS_Impact_Wood`, `NS_Spline_WaterSplash`
y `SW_Water_Slash_01` en los tres proyectos. Sin casco/cañón portable listo; Blueprint/
Niagara necesitan portado y audio no estaba exportado/audicionado. Se reutiliza runtime
actual. Fuentes `C:\Unreal` intactas. Root: diseño/autoridad/integración/aceptación;
Luna: investigación, presentación, tests, revisión independiente y navegador.

Verificación local: **15/15 nuevas + 371 casos previos seleccionados + 9/9 de host**,
395 casos únicos entre los pases documentados; **3/3 vistas emuladas** con capturas finales
inspeccionadas y cero errores/overflow. [Pruebas y artefacto](d08c12-naval-route/verification.md),
[capturas y fixtures](d08c12-naval-route/README.md). El primer pase seleccionado tuvo un error
de fixture del quinto capitán, corregido y repetido; el pase amplio fallido/interrumpido se conserva.
`tests/naval-route-drive.test.mjs` cruza el circuito mediante `SHIP_INPUT` real y amarra,
sin recolocar el casco. Las fixtures de navegador colocan casco/capitán para verificar
salvas, estado y UI; no acreditan pilotaje humano, rendimiento físico o audición. Página de
artefacto local con 283 archivos acompañantes; checkout compartido, sin commit/push/despliegue.

Siguiente: armas navales y un rival móvil/derrotable. Custodia/pérdidas públicas permanentes
siguen dependiendo de D09/M5; este ensayo no activa esa economía ni completa M5.
