# D08b — navegación de cómic: referencia y cortes visuales

2026-10-06. Referencia: imagen de persecución naval adjunta por el autor en esta conversación.
El autor confirma que **el control funciona y se siente el peso** en D08a.1. Esa aceptación de tacto
no demuestra rendimiento móvil, balance final, audio ni integración online. Ahora pide aproximar
la imagen con cuidado, por pasos. Este documento conserva la dirección completa entre sesiones.

## Lo que hace funcionar la imagen

La balsa ocupa el centro inferior, vista desde atrás y ligeramente de lado. El mar oscuro sirve de
fondo a madera, espuma casi blanca y una corriente cyan muy luminosa. El horizonte bajo y brumoso
abre la distancia; las rocas laterales dan escala. La tinta periférica y el HUD enmarcan la acción
sin tapar casco, vela ni dirección del viaje. No basta con recolorear el agua: encuadre, valores,
silueta, material, estela y jerarquía tienen que acompañarse.

Observaciones por inspección visual, **no mediciones de píxeles ni colores muestreados**:

| Capa | Detalles de la referencia | Dirección de implementación |
|---|---|---|
| Cámara | Vista de persecución, trasera 3/4; cubierta visible; proa hacia el horizonte; vela completa. Horizonte aproximadamente en el cuarto superior | Cámara naval propia, seguimiento suave del rumbo, espacio por delante y ajuste de encuadre por aspecto/tamaño. Conservar vista isométrica para comparar |
| Cielo | Gris azul, nublado, sin sol protagonista; luz difusa y aire húmedo | Preset aislado de cielo/luz/bruma, sin cambiar el día tropical del juego principal |
| Distancia | Islas rocosas asimétricas a ambos lados; tonos cada vez más claros/fríos al alejarse; canal central abierto | Rocas ancladas al mundo, varias escalas/profundidades, sin colisión ni falsa navegación de puerto |
| Mar | Azul petróleo/verde pizarra; ondas pequeñas desordenadas, crestas blancas y reflejos fríos; horizonte suavizado | Reutilizar agua/ruido existentes; eliminar destellos tropicales dominantes; distinguir agua base, crestas y corriente |
| Corriente | Franja curvada cyan, interior claro, bordes irregulares de espuma; atraviesa el espacio desde primer plano hasta lejos | Seguir el mismo campo real del laboratorio; fragmentar la banda plana en agua/espuma, nunca pintar sobre la balsa |
| Estela | Gran V blanca, remolinos y curva fuerte al girar; mucha agua expulsada a los lados | Cintas históricas + abanicos/spray de presupuesto fijo. Tamaño, persistencia y curva siguen velocidad/giro reales |
| Balsa | Madera marrón grisácea envejecida; tablones irregulares, troncos redondos, cuerdas oscuras, contornos negros | Reutilizar atlas y piezas. Ajuste local de paleta/tinta antes de crear otro material; no perder grano ni calidad del atlas aprobado |
| Vela | Lona gris verdosa, paños remendados, costuras visibles, ribetes oscuros; mástil/vergás/cabos finos | Variación local de lona, costuras y tensión. Mantener silueta y animación actual; no gastar transparencia en cada hilo |
| Accesorios | Caja, barril, rueda de timón y llantas negras como defensas | Revisar FAB/exportados antes de añadir. Son una fase de decoración, no nuevos módulos funcionales automáticos |
| Tinta de velocidad | Líneas negras gruesas/finas e irregulares desde los bordes; centro libre; perspectiva hacia la acción | Sustituir las rayas crema por tinta negra agrupada; intensidad ligada a velocidad/boost, opción de apagado y reduced motion |
| Retrato/barras | Retrato con marco de tinta; barras oblicuas HP roja y stamina verde agua arriba izquierda | Lenguaje visual futuro. No inventar HP/stamina del piloto en el laboratorio |
| Objetivo | Diamante dorado, letras crema gruesas: escapar de los piratas y carga 85% | Mensaje del ejercicio real y peso real si aplica; no simular una misión que aún no existe |
| Rival | Calavera circular + barra horizontal roja/naranja arriba centro | Reservar para encuentro NPC real. Una maqueta deberá rotularse claramente como maqueta |
| Radar | Círculo verde oscuro, aro latón/tinta, anillos y cuadrícula; triángulo cyan y puntos blancos/rojos | Carta de corriente/rumbo con datos reales primero; enemigos solo cuando existan |
| Callouts | Mint “corriente activa”, violeta “drifting”, naranja “combo x3”; condensadas, inclinadas y contorno negro | Mostrar corriente/captura perfecta/boost reales. Drift y combo esperan sus mecánicas |
| Acciones | Cuatro tarjetas ilustradas ancla/carga/ráfaga/agarrarse, marco negro y tecla debajo | Tarjetas para acciones implementadas; controles táctiles mínimos 44 px. No habilitar ancla o agarre ficticios |
| Velocímetro | Dial circular naranja con arco, efecto de fuego e indicador grande abajo derecha | Velocidad real en u/s; convertir a nudos requiere una escala aprobada. Dial claro también sin animación |

Paleta orientativa: tinta `#080f13`, mar `#102b34` / `#1b3d46`, cielo `#8ba7b5`, espuma `#e9ffff`,
corriente `#6eebed`, madera `#75664b`, papel `#f3e4bd`, acento amarillo/naranja, mint y violeta.
Los valores se calibran en capturas; no tratar estas aproximaciones como una extracción exacta.

## Orden de trabajo y aceptación

| Corte | Resultado visible | Prueba antes de avanzar |
|---|---|---|
| **B1 — cámara, mar y horizonte** | Persecución 3/4, cielo gris azul, mar oscuro con crestas, rocas entre bruma. Vista isométrica comparable | Casco/vela completos en escritorio y móvil emulado; giro sin salto al cruzar ±π; pausa; casa 4×4; ningún cambio al tacto/simulación |
| B2 — balsa y lona | Madera menos dorada, lona gris remendada, tinta/rigging coherentes, accesorios seleccionados | Comparar contra atlas aprobado, revisar FAB, UV/contornos/legibilidad y variantes 1024/512 realmente cargadas |
| B3 — espuma, corriente y tinta | Estela blanca ancha y curva, spray lateral, corriente cyan menos plana, líneas negras periféricas | Sin sobrepintar casco/vela; pools/emisión acotados; contraste de día/boost; reduced motion y pausa; medir en teléfono real |
| B4 — HUD de navegación | Dial, tarjetas, llamada de corriente/ráfaga, carta/rumbo y jerarquía cercanos a la referencia | Solo datos y acciones reales; interfaz española; teclas/mando/táctil; sin tapar vela, cielo o trayecto en horizontal/vertical |
| B5 — persecución real | Rival visible, barra/objetivo y contexto de combate de la imagen | Requiere encuentro naval NPC, daño/huida y autoridad de servidor. No se entrega solo con arte |

Una sola capa principal por corte. Capturar antes/después con viewport/cámara/fixture/tier anotados.
La referencia define el destino; **B1 no pretende tener ya su balsa, spray, HUD o persecución completa**.
Pedir reacción visual después de entregar algo comprobable; no repetir aprobación para ajustes reversibles.

## Reutilización, equipo y límites

GPT-6 Luna revisa inventarios/candidatos y módulos acotados; el principal conserva cámara, look, integración
y aceptación. Un escritor por archivo, un navegador/GPU a la vez. Fuentes `C:\Unreal` solo lectura y sin
auditoría de licencias. Registrar los candidatos exactos y su portabilidad en la entrega del corte.

B1 reutiliza agua, cielo, ruido, pipeline, geometría de roca y balsa/atlas existentes. Sin texturas ni
descargas nuevas. Rocas decorativas de geometría pequeña y presupuesto explícito, sin colliders.
Los ajustes del agua/cámara viven en `tools/naval-lab/`, no cambian el render de la isla principal.
El corte [B2 de madera aportada por el autor](d08b2-author-raft-material.md) añade un perfil optativo
por instancia a `RaftLayer`, con UV/materiales propios solo en la bahía. Preparación/integración y 73/73
pertinentes verificadas; captura y aceptación visual aún pendientes por fallo del controlador de Chrome.
Conservar control, fuerzas, viento, carga, timing, audio y contratos actuales. M5/D09, SQL008 y la ruta
visual del puerto son trabajo separado y conservan sus gates; no modificar sus archivos concurrentes.

Revalidación B1: `Dreamrise_SMSK/Assets/Meshes/SM_Rock.uasset` (22.059 B) y
`NiagaraExamples/StaticMesh/S_Rock_shopk.uasset` (31.254 B) existen en las fuentes Unreal. Sin GLB/preview
verificado ni encaje de material demostrado: requieren exportación y revisión. Reutilizar los helpers
`ico/lumpy/part` de `src/render/geo.js`, a partir de la receta de roca privada en `vegetation.js`.
Nueve formaciones fijas en un mesh, 945 triángulos; el corredor inicial permanece abierto y no tiene
colisión. Es una bahía finita de prueba, no generación de islas a lo largo de una ruta infinita.
El atlas existente sigue en 308.536 B escritorio / 82.878 B móvil; la caja GLB de 51.684 B y aparejo
procedural siguen disponibles para B2. No hay un candidato de llanta naval útil ya validado.
