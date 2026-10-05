# A01 Noise00 — preparación Phase A

Estado: preparado; no integrado. Base leída: HEAD `f9ddb17` (A01 requiere una línea base M4.8 aprobada; el encargo limita esta fase a ese commit y al dry-run).
Fuente (solo lectura): `C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\sA_Megapack_v1\sA_Projectilevfx\Vfx\Materials\Textures\Noise00.png`.
SHA-256 fuente: `4B340D88FB318748461BD7EEBDA98D9C0CF7E8D7C4E870BE2412A2EA1AA86AF5`.
Copia aislada: `shots/asset-a01/Noise00.png`; SHA-256 idéntico: `4B340D88FB318748461BD7EEBDA98D9C0CF7E8D7C4E870BE2412A2EA1AA86AF5`.
Tamaño: 287,022 bytes. Pillow decodificó PNG 1024×1024, RGBA (R,G,B,A), 8-bit; memoria RGBA estimada 4,194,304 bytes.
Dry-run: `node tools/import-asset.mjs shots/asset-a01/Noise00.png --id=tex:a01-noise00 --dry` — válido; 0.27 MB; no escribió manifiesto.
Hook propuesto (sin cambios): `src/render/vfx/effects.js` asigna un nuevo shape exclusivo a las wisps de humo de fogatas; `src/render/vfx/particles.js` añade una rama shader para ese shape. El volcán y otros consumidores siguen su rama procedural.
La rama nueva usa `uA01SmokeNoiseTex` solo para el shape dedicado; muestrea canal R como breakup de opacidad. UV local por punto desplazada por seed/vida, con `RepeatWrapping`, repetición 1×1 y `NoColorSpace` (`data:true`).
Fallback: inicializar el uniforme con `U.mnNoiseTex` existente; sustituirlo por `assets.texture('tex:a01-noise00')` solo si cargó correctamente. Si falta/falla, conserva el ruido procedural B. No reemplazar `U.mnNoiseTex` global.
Evidencia de hojas: `particles.js` SHAPE.WISP lee `mnNoiseTex` canal B; `effects.js` emite wisps de fogata en L200–203 y wisps de volcán en L233. Separar fogata evita ampliar el experimento al humo del volcán.
No se editaron sim, protocolo, economía, renderer, wiring ni manifiesto. Fuente Unreal permaneció solo lectura; no hubo exportación ni arranque Unreal.
No se ejecutaron pruebas/runtime ni capturas; comparación visual, fallback en navegador y decisión keep/defer quedan pendientes de Phase B.
