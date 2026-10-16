# Cartografía compartida — minimapa y mapa grande

2026-10-09. Implementación y aceptación local del corte de mapas, sobre alpha.16/protocolo 32.

## Resultado

El círculo naval previo era una brújula: no dibujaba costas. Ahora un minimapa circular muestra el terreno
activo, posición/orientación del jugador, lugares conocidos, compañeros, balsas recibidas y destino real.
Está disponible caminando y pilotando, en PC y touch. Click/tap abre el mismo panel que M; Escape lo cierra.
La vista al timón sigue la pose de la embarcación; en cubierta/tierra sigue al personaje. El destino lejano
se señala con un aro dorado en el borde, sin inventar enemigos, ciudades o recursos descubiertos.

Mapa grande y minimapa reutilizan un único atlas canvas de 640×640 por objeto/revisión; el local se centra
en el jugador, con radio de 80 unidades en PC y 65 en touch, y se redibuja como máximo diez veces por segundo.
No se crea otra cámara Three.js ni se captura la escena 3D. El encuadre legacy 255 se conserva para esta isla.
El panel M ajusta su ancho a la altura disponible en celular horizontal; sus controles navales no lo cubren.

La UI consulta el mapa activo de la escena y cambia los dos paneles juntos si se reemplaza su referencia.
Esto prepara la presentación; no implementa un cambio de región, transferencia de autoridad o streaming.

## Contrato para el mapa definitivo

`src/ui/cartography.js` adapta los datos legacy y admite metadatos de presentación:

```js
map.cartography = {
  title: 'Nombre del mapa',
  revision: 'layout-1',
  bounds: { minX, maxX, minZ, maxZ },
  points: [{ id, name, kind, x, z }],
  regions: [{ id, name, kind: 'danger', x, z, r }],
};
```

Los límites son coordenadas de mundo XZ; la proyección calcula el encuadre de sus cuatro esquinas,
incluidos mapas desplazados y rectangulares. Los nombres se escriben como texto, no HTML. Arrays vacíos
explícitos eliminan los puntos/rings legacy. Sin límites válidos, se deriva un encuadre de `size`/`half`
y los puntos/rings disponibles; el mapa definitivo debe declarar sus límites completos de terreno.

Cambiar `cartography.revision` o `terrainRevision`, los metadatos o las funciones de terreno invalida
el atlas compartido. Si se modifica una cuadrícula detrás de la misma función, se debe subir su revisión.
`MapView.setMap(map)` y `MiniMap.setMap(map)` permiten reemplazar las entradas del dibujo. Una nueva
geografía sigue necesitando datos concordantes en servidor, colisiones, navegación y renderer; esto
no convierte una imagen o unos POIs en pueblos funcionales.

Los objetivos de las misiones actuales mantienen un adaptador legacy tolerante a anclas ausentes.
Las misiones regionales nuevas deberán aportar sus destinos reales. No se añaden zoom/pan, descubrimiento,
rutas calculadas por terreno ni un atlas de sectores descargable en este corte.

## Reutilización comprobada

El inventario Unreal ofrece `BP_Minimap.uasset` (17.392 B) y `BP_OverviewMap.uasset` (29.175 B), presentes
en `C:\Unreal\ActionRPGMultiplayerStart\Content\ActionRPGStarterSystem\Minimap`. Son paquetes Blueprint;
no se ejecutan en el cliente web ni sustituyen nuestras consultas de terreno. Se reutilizó el raster
canvas de `MapView` como base del atlas compartido y el marco de brújula ya dibujado en el HUD.
No se exportaron/modificaron las fuentes ni se crearon texturas, imágenes alpha o dependencias nuevas.

## Verificación

- **14/14**: ocho contratos de proyección/cartografía y seis regresiones del terreno actual.
- **22/22**: acciones touch, ruta/reentrada y recorrido naval por la costa real.
- **3/3 vistas** en `tools/qa-cartography.mjs`: PC 1365×768, touch 844×390 y retrato 390×844 con stage rotado.
  Partida ordinaria `dev:false`, host efímero/store de memoria, entradas reales para abrir/cerrar/montar.
  Minimapa en tierra/timón, atlas compartido, panel libre de controles y cleanup. Quince capturas.
- Fixture de presentación de **1.200×1.000** fuera del origen, con dos islas: encuadre/POIs nuevos,
  sin labels legacy, cambio de revisión/terreno/función sin atlas viejo. Solo reemplaza entradas UI de QA;
  no añade pueblos ni terreno al mundo autoritativo. [Evidencia](cartography/evidence.json).
- **3/3** regresiones completas del HUD naval en un directorio nuevo `.scratch/cartography-hud`, con
  teclas/slots, timón/cubierta, pausa, atraque y disposal. No se sobrescribió la evidencia histórica.

Aceptación local y emulación; no mide FPS físico ni capacidad multijugador. Sin cambio de versión/protocolo,
perfil, simulación, SQL, `.env` o reinicio/despliegue de host. La URL pública de la prueba del autor no se ha
verificado en este corte.

## Plan de juego que sigue

Navegación/carga/daño/reparación y recolección/herramientas/crafting básicos están integrados en la partida.
Este corte deja la cartografía ligada a datos del mundo. Los siguientes pasos del alfa conservan el orden
de [PLAN-ALFA-MUNDO](../../PLAN-ALFA-MUNDO.md): A0 anclas funcionales de Salty Shore coordinadas con arte;
A1 identidad/guardado y aportes atómicos antes del tablero, carpintería y recetas aprendidas; A2 construir
y navegar con lo desbloqueado; después A3 Puerto Sol/corredor terrestre y A4 Bahía Ceniza. Los tres pueblos
caminables y sus rutas aún no están montados. Ocho conexiones y regiones/miles siguen sujetos a medición.
