# AREA07 RNV03 — noche oscura con luz utilizable

[Contrato](../briefs/rnv03-dark-night.md). Alpha.28/protocolo 40.

## Implementación local

El árbol de trabajo implementa el farol básico de cinturón, su acción N/toque, confirmación por la
autoridad de sesión y réplica en snapshots. Se apaga al morir y al salir/reentrar; no crea un objeto
comercial, gasto, combustible, persistencia de perfil, SQL ni un writer nuevo. Los bots/agentes no
obtienen la capacidad mediante este corte.

La partida toma la hora de la simulación compartida aun si existe una preferencia antigua de luz o
un `?tod=day`. Los presets quedan disponibles fuera de juego para fixtures. La noche reduce el
relleno ambiental, el contorno y la iluminación del agua; las fuentes localizadas existentes siguen
activas. La Caldera conserva sus fuentes locales sin reponer el relleno global nocturno. La luz
portátil usa el anclaje girado del modelo de cinturón y prioriza el farol propio en los presupuestos
de 4, 8 y 12 luces.

El arte del farol es procedural. La referencia Unreal verificada en solo lectura fue
`C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\Assets\Meshes\SM_Torch.uasset`
(21,751 bytes) y `Blueprints\BP_Building_Torch.uasset` (35,153 bytes). La antorcha azul es una
referencia distinta del farol naval cálido. No se modificó ni exportó ningún archivo Unreal.

## Validación local

- Selección integrada final en serie: **650/650** aprobadas, cero fallos, 186 s:
  [salida](rnv03-dark-night/integrated.tap).
- Selección de release: **107/107** aprobadas, cero fallos:
  [salida](rnv03-dark-night/release.tap).
  Esta selección se solapa con la integrada y no se suma como cobertura independiente.
- Render/luz: **25/25**; interfaz: **13/13**; autoridad del farol: **6/6**. Estas selecciones
  también se solapan con la integrada.
- `git diff --check` pasó durante la revisión local.

Estas pruebas verifican contratos, reloj, serialización/replicación, interruptor, muerte/reentrada,
prioridad de luz y selección por calidad. [Simulación/render adicional](rnv03-dark-night/sim-render.tap):
24/24, también con solapamiento. No sumar las selecciones como casos únicos.

Una repetición paralela bajo actividad gráfica dio 649/650 por caducidad de 1,5 s en
`agent-market-runner`; [repetición aislada](rnv03-dark-night/market-repeat.tap) 1/1 y suite final
en serie 650/650. No se relajó el límite ni se cambió código de agentes.
La extensión de apariencia dio 29/30: el hash de fuente raw cambia con `core.autocrlf=true`;
[diagnóstico](rnv03-dark-night/appearance-baseline.json) demuestra que LF reproduce exactamente
HEAD y recibo. No se cambiaron arte, recibos ni esa prueba ajena.

## Navegador local

**4/4 vistas**: PC 1280×720 y móvil emulado 390×844 (stage girado), bajo/alto, ES/EN para los
controles nuevos. [Evidencia final](rnv03-dark-night/evidence-2026-10-10T20-40-07-644Z.json).
Reloj del host fijado a medianoche/amanecer y reubicación descartable; espera de cámara y
proyección en pantalla, teclas/toques reales, fuente/núcleo, movimiento, apagado, invitado público
y muerte. Puerto con fuentes existentes, noche y día; control de 48 px, sin colisión del botón
con tracker/ataques/construcción ni overflow. Cero errores de consola/página/red.

Capturas representativas inspeccionadas: [costa apagada](rnv03-dark-night/night-desktop-low-es-2026-10-10T20-40-07-644Z-01-dark-no-personal-light.jpg),
[encendida](rnv03-dark-night/night-desktop-low-es-2026-10-10T20-40-07-644Z-02b-personal-lantern-on-late.jpg),
[móvil bajo](rnv03-dark-night/night-mobile-low-en-2026-10-10T20-40-07-644Z-02b-personal-lantern-on-late.jpg),
[puerto nocturno](rnv03-dark-night/night-desktop-high-en-2026-10-10T20-40-07-644Z-04-port-midnight-off.jpg),
[amanecer](rnv03-dark-night/night-desktop-high-en-2026-10-10T20-40-07-644Z-07-port-day-off.jpg)
y [luz de otro jugador](rnv03-dark-night/night-desktop-high-en-2026-10-10T20-40-07-644Z-04-nearby-player-lantern.jpg).

Regresión naval **4/4**: [evidencia](rnv03-dark-night/naval-regression/evidence-2026-10-10T20-37-06-183Z.json),
farol pagado V/toque, interior con cutaway, giro/movimiento, daño y reparación apagada, a medianoche.
Materiales/reubicación/daño son fixtures declaradas. No acredita travesía humana ni FPS físico.
El primer intento encontró `setLantern` ausente en dummy/cannon/crab: se admite su vista sin accesorio,
se repitieron las cuatro vistas y se confirmó ausencia de errores. Las capturas iniciales durante la
entrada de cámara se sustituyen como aceptación por la evidencia final asentada; se conserva el historial.

## Publicación y siguiente corte

- Probe real F → timón → N/toque → E → cubierta → V → N/toque apagado: **2/2**, PC/móvil bajo,
  [evidencia](rnv03-dark-night/deck-probe/evidence-2026-10-10T20-46-53-513Z.json).
  Fuente/núcleo siguen exactamente la raíz renderizada; capturas inspeccionadas. El primer probe
  comparaba la pose remota `rec.r` del jugador local y agotó la espera; se corrigió la fixture para
  comparar la pose que realmente usa el renderer, sin cambio de gameplay. Conserva el intento.
  El botón naval PC queda encima del velocímetro; móvil conserva separación del arco de acciones.
- **Aceptación local completada**; noche/faroles y regresión naval comprobados. No acredita navegación
  humana prolongada ni una travesía en mar abierto.
- **Despliegue pendiente:** updater existente, revisión/imagen/salud/entrada pública por verificar.
- Sigue agua costera/reembarque: primero contrato de carga, agotamiento, rescate y pérdidas.

La luz local no proyecta sombras ni oclusión por paredes. La noche oscura es una regla de
presentación, no una frontera contra clientes modificados. No se midió FPS físico ni latencia WAN.
