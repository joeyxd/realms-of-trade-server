# GM04d: palmeras talables y piedras recogibles

2026-10-11. Implementado en alpha.61, protocolo 59. Publicación del runtime pendiente
de la comprobación final del VPS; SQL036 instalada por el autor y readiness vivo 1.
[Contrato](../../briefs/gm04d-functional-resources.md).

## Uso

Editor del mundo → **Recursos** → **Palmera talable** o **Piedra recogible** → Colocar.
Escena permite mover, duplicar, retirar y deshacer. La altura sigue el suelo; la palmera
admite giro y escala 0,75–1,25. La piedra mantiene el tamaño del recurso normal.
Guardar conserva el borrador privado. **Online → publicar/activar** habilita la recogida
cuando el mundo está vacío y pasan las validaciones existentes. La decoración de Biblioteca
y Dispersión sigue disponible; el nuevo tipo funcional se elige explícitamente en Recursos.

Se conservan el hacha, tres golpes, dos troncos, práctica cooperativa, recogida de piedra,
cooldowns y respawn normales. Mover o volver a publicar el mismo ID conserva el trabajo y
agotamiento; duplicar crea una identidad nueva. Retirar conserva su fila inactiva para rollback.

## Persistencia y límites

- Hasta 128 recursos añadidos activos por revisión y 1024 filas durables en total, incluida
  la base y los IDs retirados. Alcanzar el techo rechaza la admisión; no poda historial.
- SQL036 amplía el validador histórico y ofrece una admisión append-only con CAS. Conserva
  reloj, cooldowns, nodos/ledgers existentes y todos los otros campos del mundo.
- La admisión ocurre bajo el lease de mundo vacío antes del puntero de contenido. Un fallo
  posterior al SQL deja filas inactivas; un ACK SQL incierto detiene la autoridad hasta reinicio.
  El registro existente reconcilia un ACK perdido del puntero.
- El piloto alternativo de autoridad de suelo no ofrece esta admisión; rechaza antes de escribir.
- Documento v2–v4 y SQL033 conservados. No cambia el sobre de snapshots/`you`; GM04d
  no añade campos. La integración conserva el protocolo 59 de compañeros; alpha.61 y la
  identidad de contenido requieren recarga compatible.

## Verificación local

- [CPU final](final-cpu.json): **418/418**, 70 archivos seriales sobre upstream `9ea14a0`,
  incluye autoridad normal, permisos/herramienta/rango, cliente/servidor, publicación,
  hashes, render y recuperación de los límites SQL/puntero.
- [SQL final](final-sql.json): **8/8**, SQL001–036 en PGlite más baseline del taller.
  Seis casos de SQL036: v1/v2/v3, CAS/no-op, límites/aislamiento/permisos, guardado ordinario,
  recibo SQL033 histórico y recibos reales de GameHost para palma completa y piedra/replay.
  En esa última fixture se espejan los autosaves de memoria al SQL antes de cada recibo;
  acredita el escritor/recibo, no una conexión Supabase de gameplay de extremo a extremo.
- [Navegador local](local/browser.json): **9/9**, auth simulada, UI y modelos reales,
  ES/EN, escritorio y móvil emulado. Colocación por canvas, separación atómica, inspector,
  duplicar/borrar/undo/redo, movimiento con ID estable y guardado/reapertura local.
  Capturas inspeccionadas. El runner sustituye CDN Three/GSAP por la misma versión local.
- [Readiness Supabase](sql-ready.json): **1**, después de ejecutar la última SQL036.
- [Integración concurrente](concurrent-integration.json): **26/26**, rutas y autoridad de
  perlas del nuevo upstream `9ea14a0`, después de integrar el cambio en GameHost.
- [Recheck de la integración final](merge-recheck.json): **70/70** en alpha.61/protocolo 59,
  después de conservar el emparejamiento de compañeros concurrente. Recursos funcionales,
  publicación/host y sus cuatro grupos de cliente, UI, red y controlador.

Los conteos de grupos se solapan. La [primera regresión amplia](regression.json) quedó
418/420: `resource-loop-server.test.mjs:143` espera fabricar con un tronco, mientras la
receta actual pide dos. [Reproducido en upstream intacto](upstream-resource-loop.json),
4/5 en `e625a5c`; fuera del grupo final, sin alterar esa receta ni prueba ajenas.
El otro fallo fue OOM de PGlite al ejecutar el baseline del taller concurrentemente;
su repetición serial pasó 2/2 y está incluida en SQL final. No se declara la suite completa verde.

## Arte y presupuesto

Reutiliza `model:palm-tall-v1` y `model:coast-rock-v1`, sus derivados y materiales actuales.
Sin nuevas texturas, modelos descargables ni dependencias. La palmera privada usa la misma
geometría/materiales que el recurso; el renderer de recursos es el único dueño de la figura
publicada. La capa decorativa omite sus aliases para evitar duplicación visual.
El máximo activo es 334 nodos contando el techo base de 206. Las instancias de la variante
de palma 0 y sus tocones reservan 96 + número de palmas GM (hasta 224); las otras variantes
mantienen 96. Solo los recursos activos se dibujan; las filas retiradas no crean geometría.
Las pruebas de datos y móvil emulado no acreditan FPS de un teléfono físico.

## Siguiente corte acordado

[Taller de habilidades](../../briefs/skill-studio-vision.md): ajustar primero habilidades
actuales con personaje, animación y efectos visibles, comparación original/borrador y
parámetros. El autor pidió incluir una **adaptación real de Niagara** en ese primer corte.
[Intake](../../research/unreal-assets/SKILL-STUDIO-INTAKE.md): candidato `NS_Spline_WaterSplash`
existente en `C:\Unreal`, para revisar frente a Tromba. Es inventario y verificación de archivo;
el efecto aún no fue abierto, convertido ni integrado. Fuentes Unreal intactas.
