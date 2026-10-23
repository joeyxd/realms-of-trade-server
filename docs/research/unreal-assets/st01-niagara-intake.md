# ST01 Niagara intake: WaterSplash

Fecha: 2026-10-12. Revisión de `NS_Spline_WaterSplash` en una copia aislada del proyecto UE 5.8 para el taller de Tromba. Esta ficha registra inspección y un intento de referencia visual; todavía no acepta la adaptación.

## Hallazgos comprobados

El sistema `/Game/_SplineVFX/NS/NS_Spline_WaterSplash` carga como `NiagaraSystem`. La inspección de Asset Registry resolvió y cargó 20 dependencias propias, todas dentro de `_SplineVFX`: `MF_RotateVectorWithAngle`, cinco instancias de material, cuatro materiales padre y nueve texturas. Los módulos `/Niagara` resuelven desde el motor. La lista íntegra de paquete/clase/carga está en [st01-niagara-evidence.json](st01-niagara-evidence.json); no incluye bytes de texturas fuente.

El mapa `/Game/_SplineVFX/Demo/OverView_DemoScene_Spline` carga y contiene un `BP_SplineVFX_WaterSplash_C` colocado. La Blueprint anuncia `UserConstructionScript` y `EventGraph`. La API Python permite enumerar los nombres de grafo, pero `EdGraph.Nodes` está protegido; la lógica del spline y sus parámetros no quedan comprobados. El wrapper de `NiagaraSystem` tampoco expone `emitter_handles` ni `exposed_parameters`. Hay tipos `NiagaraExt_*` en el módulo, pero la inspección no encontró una biblioteca API que devuelva sus datos de forma directa. No afirmo renderer, emitters, parámetros de usuario, ni comportamiento concreto.

`warmup_time=0`, `warmup_tick_count=0` y `fixed_tick_delta=false` sí son propiedades legibles. Se exportaron a scratch dos derivados TGA con `TextureExporterTGA`: `T_Vfx_Stuff_splash_03` (65,554 bytes) y `T_Vfx_Stamp_WaterSplash_77` (12,582,930 bytes). No se exportó ninguna textura al bundle del juego.

## Captura visual y bloqueo actual

La copia oculta UE 5.8 se ejecutó sin `-nullrhi`, con `-RenderOffscreen`, `SceneCaptureComponent2D`, `RenderingLibrary.create_render_target2d` y `NiagaraComponent.advance_simulation` en 6, 24 y 48 ticks de 1/60 s. El proceso terminó con código 0 y recorrió las tres llamadas de exportación, pero Unreal registró `ExportRenderTarget: render target has been released`. No se creó ningún PNG; las edades solicitadas no son evidencia visual.

Se preparó y ejecutó una corrección que llama `update_resource_immediate(True)` y comprueba que exista cada archivo antes de registrarlo. El wrapper UE 5.8 de `TextureRenderTarget2D` no expone `update_resource_immediate`; el intento terminó antes de capturar (23 s), con 0 PNG. No se hicieron más pruebas de API. El script y su error están en `.scratch/st01-unreal/capture_st01.py` y `capture/retry_update_resource.stdout.txt`. `SceneCaptureComponent2D` tiene documentación Python para `capture_scene`, y Niagara para `advance_simulation`; véanse [SceneCaptureComponent2D](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/SceneCaptureComponent2D) y [NiagaraComponent](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/NiagaraComponent). `RenderingLibrary.create_render_target2d` y exportación están documentadas por Epic en [Create Render Target 2D](https://dev.epicgames.com/documentation/en-us/unreal-engine/BlueprintAPI/Rendering/CreateRenderTarget2D) y [Kismet Rendering Library](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/UKismetRenderingLibrary).

Una prueba de introspección del grafo escribió su JSON e informó ejecución Python correcta, pero UE tuvo una excepción de acceso durante el cierre del proceso (código 3). No repetí esa consulta. El intento de captura terminó sin proceso colgado.

## Preparación y límites

Se copiaron 113 archivos bajo `Content/_SplineVFX` (77,634,831 bytes) a `.scratch/st01-unreal`, con rutas `/Game` conservadas y solo los plugins del proyecto `PythonScriptPlugin`, `EditorScriptingUtilities` y `Niagara`. Tras las ejecuciones, los 113 SHA-256 de `C:\Unreal\MyProject` seguían iguales. El proyecto fuente permanece intacto. Se redujo la configuración del scratch al mapa de inicio.

La dependencia de spline hace que el sistema aislado no baste para aceptar el efecto. La siguiente revisión debe capturar el actor del mapa y el sistema en una cámara comparable, leer el renderer/material y obtener parámetros verificables antes de recrearlo en Three.js. No editar `C:\Unreal` ni llamar adaptación completada a la presencia del asset o a la mera exportación TGA.