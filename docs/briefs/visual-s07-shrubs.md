# S07 — arbusto tropical independiente

Fecha: 2026-10-07. El autor autorizó convertir la prueba de arte v1 en arbustos visibles en el mapa local. Este corte añade las variantes redonda, baja y alta, manteniendo el concepto generado y su procedencia como referencia.

## Reutilización comprobada

Consulta puntual y de solo lectura: `C:\Unreal\MyProject\Content\BigNiagaraBundle\NiagaraWeather\StatickMesh\SM_Leaf.uasset` (101.110 B), del inventario Unreal existente. Se clasifica como candidato de hoja de Niagara. No tiene preview ni compatibilidad/dependencias de arbusto completo verificadas; se difiere su reutilización. El proyecto Unreal permanece intacto.

## Contrato del corte

- Arbusto tropical independiente con tres formas: redonda, baja y alta; tallos cálidos y hojas anchas pintadas y entintadas, siguiendo el concepto v1 y la vegetación existente.
- Variantes y distribución estables del renderer, limitadas a 900 arbustos. Son detalles cosméticos: no consumen RNG, no modifican props ni colisiones y no añaden gameplay, recogida o persistencia.
- Modelos portables con UV y fallback procedural. Las fuentes, recibos y snapshots quedan fuera del bundle.
- Atlas 2×2 de color/normal por dispositivo: PC 512×512 y móvil 256×256. El alpha de color gobierna el recorte; se conserva el alpha de huecos interiores y se deja margen por tile para el filtrado. Las texturas fuente completas permanecen fuera del bundle y cada cliente carga solo su variante.
- El normal se trata como dato lineal. La generación fue solicitada con la herramienta integrada; su backend/modelo no se verificó y no se certifica bake tangente sobre estas mallas.
- El corte no reemplaza las plantas bajas que S06 coloca junto a palmeras.

## Revisión local

Comprobar geometría, UV, normales, alpha, variantes, distribución, fallback y resolución realmente cargada en escritorio, móvil emulado y calidad baja. Separar capturas de mapa real de galerías temporales de revisión. La evidencia debe registrar el seed, casos positivos y fallos inyectados. Una prueba emulada no certifica FPS en un dispositivo físico.

FPS físico, backend de generación, bake certificado y revisión artística final quedan fuera de aceptación salvo evidencia posterior específica.
