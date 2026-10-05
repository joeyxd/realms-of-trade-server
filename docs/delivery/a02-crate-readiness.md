# A02 — preparación de la primera caja

Fecha: 2026-10-04. Estado: fuente y herramientas localizadas; **sin exportación ni integración**. Investigación Luna, verificación del principal.
Fuente solo lectura: `C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\Assets\Meshes\SM_StoragePart_03.uasset`, 24.248 bytes.
SHA-256: `BD7CE7B0CDDCA5C2F3E7472C79605ABB1CF7B1EB3E25C6D8411DB0739976B966`.
`SimpleMultiplayerSurvival.uproject` declara EngineAssociation `5.8`. No se abrió el proyecto fuente ni se ejecutaron sus scripts/plugins.
Editor en disco: `C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor.exe`; metadatos FileVersion/ProductVersion `++UE5+Release-5.8-CL-55116800`.
Exportador: `Engine\Plugins\Enterprise\GLTFExporter\GLTFExporter.uplugin`, VersionName `1.3.1`, EnabledByDefault true; DLL `Binaries\Win64\UnrealEditor-GLTFExporter.dll` presente. Esto no prueba arranque/carga/exportación.
El inventario enlaza la malla con `BP_LootBox` y sus componentes de loot/interacción; no acredita todavía sus dependencias de materiales/texturas ni bulk data. Blueprint no se porta como gameplay.
Destino inicial: reemplazo visual de un `crate` existente mediante `prop:storage-crate`; no añade bodega, permisos, inventario ni persistencia.
Próxima misión: identificar dependencias de esta malla y preparar un proyecto mínimo aislado bajo workspace/temporal; abrir/exportar únicamente la copia, con caches/configuración/derivados fuera de `C:\Unreal`.
Luego exportar GLB, revisar silueta/materiales/pivote/bounds/triángulos/tamaño y ejecutar `node tools/import-asset.mjs <staging.glb> --id=prop:storage-crate --props=crate --dry`.
El principal integra solo tras comparación procedural/candidato, caída al procedural, día/noche/high/low/móvil y coste revisados. Sin cambiar el manifiesto compartido durante preparación.
Un fallo de exportación no bloquea D04: balsa/cubierta/editor pueden avanzar con geometría procedural. No se descargó, copió ni exportó este recurso en esta preparación.
