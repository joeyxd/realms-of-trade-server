# A01 — Noise00: resultado Phase B

Fecha: 2026-10-04. Decisión del principal: **aplazado para humo de fogatas**; el runtime principal conserva su efecto procedural.
Base del experimento: Tormenta `f9ddb17`, protocolo 10; checkpoint experimental `d805d79` en worktree aislado `.claude/worktrees/a01-canary`, independiente de Tinta concurrente.
Fuente solo lectura: `C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\sA_Megapack_v1\sA_Projectilevfx\Vfx\Materials\Textures\Noise00.png`.
SHA-256 fuente/copia/importación: `4B340D88FB318748461BD7EEBDA98D9C0CF7E8D7C4E870BE2412A2EA1AA86AF5`; PNG 1024×1024 RGBA8, 287.022 bytes (280,3 KiB).
Coste: 4 MiB RGBA decodificado; ~5,33 MiB con mipmaps. El registro precarga el manifiesto aunque ninguna fogata sea visible.
Hook experimental: `effects.js` usa FIRE_WISP solo en fogatas; `particles.js` muestrea R, RepeatWrapping, repetición 1×1, `data:true`/NoColorSpace; demás wisps conservan B de `U.mnNoiseTex`.
Dry-run/check, 8/8 tests de assets y lista del artefacto experimental desde commit (PNG/manifiesto incluidos) pasaron; el PNG importado es idéntico a la fuente. No se exportó ni arrancó Unreal.
Comparación: nueve partículas representativas de humo congeladas, misma cámara/luz/tiempo en cada pareja; baseline procedural → Noise00, sin sustituir el ruido global. Datos durables: [evidencia JSON](a01-noise00-evidence.json).
Capturas locales: `shots/asset-a01/{high-day-final,high-night,low-phone-day,low-phone-night}/01-procedural.png` y `02-noise00.png`; principal inspeccionó las ocho.
Diferencia visible tenue: no mejora clara de forma, detalle o legibilidad que compense descarga/memoria. La decisión se limita a este consumidor, no descarta la textura para todos los VFX.
Draw calls baseline/candidato: 111/111 día high, 115/115 noche high, 75/75 día low móvil, 79/79 noche low móvil; geometría y cantidad de partículas iguales dentro de cada pareja.
Dispositivo: Chrome 154 headless, ANGLE Vulkan SwiftShader; escritorio 1280×720 y móvil emulado táctil 844×390, DPR 1. Capturas congeladas no miden FPS, animación ni rendimiento GPU real.
Fallback `?noassets`, 404 y PNG inválido: 3/3 pasaron, loadedFlag=0, escena intacta y PNGs de cada pareja idénticos byte por byte; error de registro esperado en 404/PNG inválido. Sin errores JS de juego en los siete casos; fuentes Google bloqueadas.
La cuenta de texturas de cada pareja ya incluye el candidato precargado: no acredita coste GPU cero; high día cargado=50, deshabilitado=49.
Reproducción: `node tools/look-assets.mjs`; configurar MN_PLAYWRIGHT/MN_BROWSER/MN_THREE/MN_GSAP a instalaciones locales, OUT, Q, TOD, PHONE/VW/VH y ASSET_FAILURE según cabecera del script.
Conservar código/manifiesto/PNG/harness únicamente en el experimento aislado. Sin push, despliegue ni publicación; integración/revalidación con Tinta no realizada aquí.
Siguiente: preparar A02 `SM_StoragePart_03` sobre hook `crate`, sin sustituir gameplay ni almacenamiento; D02 Tinta y D03 cierre mantienen su aceptación independiente.
