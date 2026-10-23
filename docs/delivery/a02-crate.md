# A02 — primera caja FAB integrada

Fecha: 2026-10-04. Preparación `9a76925`; revisión de juego `626beb7` (rc.1, protocolo 12). Commit: consultar `git log -- docs/delivery/a02-crate.md`.
**Aceptada localmente**: caja Dreamrise con tablones e interior abierto en los `crate` estáticos de la isla, mediante el consumidor existente. Principal integra/revisa; tres workers GPT-6 Luna preparan tooling y comprobaciones.
Fuente: `C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\Assets\Meshes\SM_StoragePart_03.uasset`; malla + `MI_Base_Normal`, `M_Base`, `T_ColorPalette`, 73.699 B. Hashes originales verificados antes/después.
Proyecto fuente sin abrir; sin guardar paquetes ni ejecutar sus scripts/plugins. Copia mínima separada bajo `C:\DEV\real of trade\asset-staging\a02-export\project`, fuera de `.claude`; DDC/shaders/Saved/derivados locales.
UE 5.8 CL-55116800, glTF Exporter 1.3.1. La salida NullRHI era blanca y se rechazó. Render D3D12/SM5 terminó exit 0, 0 errores/7 avisos; ~28,5 min de caché fría. Detalles en JSON.
GLB final: **51.684 B, 204 triángulos, 408 vértices, una parte/material**, sin rig/animaciones; paleta PNG 1024², 22.526 B. Bake solicitado 512² no limita texturas exportadas directamente.
Estimación paleta RGBA8: 4 MiB base / **5,33 MiB con mipmaps**; no medición de VRAM. GLB SHA-256 `916814feae7a2068b47b292439873d64f717cdc8b3821a6f6b2d906cf1293273`.
Destino: `assets/models/prop-storage-crate.glb`, manifiesto `prop:storage-crate` → `crate`, ajuste `proc`. Base de la caja sobre suelo, altura ajustada ~0,703 u frente a 1 u; footprint próximo al objetivo con tolerancia existente del 15 %.
No cambia sim/mapa/colisionadores/protocolo ni cajas flotantes. La caja sigue decorativa: bodega, permisos y persistencia se implementan aparte.
CLI `--dry`, `--check` (1 asset OK) y 8/8 tests de assets pasaron. Siete pares A/B inspeccionados: iluminación día/noche high escritorio y low móvil 844×390, `?noassets`, 404 y GLB inválido; 0 errores de página/juego, fallback procedural intacto.
En esta escena: 7 instancias comparten una parte; high +4 calls/+4.848 tri y low +2/+2.424 tri por render. Incluye el culling distinto del grupo instanciado frente a chunks procedurales; no es FPS ni coste por malla aislada.
Chrome SwiftShader, tiempo/cámara congelados y mapa original conservado. `?tod` fuerza iluminación sin cambiar el reloj de gameplay; prompts ocultos solo en QA. Memoria `renderer.info` contaminada por reconstrucción; bounds son ajuste visual, no test independiente de colisión.
Aceptación: interior y tablones aportan detalle legible también en low; estilo toon coherente, noche oscura como otros props. GPU/teléfono/mando físicos, rendimiento, carga temporal, publicación y despliegue pendientes.
Evidencia durable: [JSON](a02-crate-evidence.json). Capturas locales: `.claude/worktrees/a02-crate/shots/asset-a02/{high-day-clean,high-night,low-phone-day,low-phone-night,disabled,missing,bad}/`.
Reproducir exportación: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/stage-a02-crate.ps1 -StageRoot <carpeta nueva bajo workspace fuera de carpetas con punto> -Export -RenderMaterials`; hashes fijos y rechazo de sobrescritura. Preparación ejecutada; render exitoso usó launcher manual equivalente.
Reproducir QA: importar con `tools/import-asset.mjs <GLB> --id=prop:storage-crate --props=crate`; `tools/look-prop-canary.mjs` acepta `Q/TOD/PHONE/ASSET_FAILURE` y las rutas `MN_PLAYWRIGHT/MN_BROWSER/MN_THREE/MN_GSAP` del HANDOFF.
Bundle verificado: `59b5b35`, `dist/a02-crate-59b5b35/`, 129 archivos/1.500.476 B; hashes contra Git y GLB incluidos. Smoke HTTP low móvil: 7 instancias, 0 errores JS/juego, captura inspeccionada; sin publicación ni despliegue.
Siguiente: [D04 P1 balsa amarrada y sincronizada, luego P2 cubierta](d04-raft-readiness.md). Banco Dreamrise aún sin exportar; esta adopción no crea piezas modulares de balsa.
