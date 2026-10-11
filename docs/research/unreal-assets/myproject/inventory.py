"""Bounded, read-only inventory for the MyProject Unreal portability review."""
from pathlib import Path
from collections import Counter, defaultdict
import csv, json

ROOT = Path(r"C:\Unreal\MyProject")
OUT = Path(__file__).parent
SKIP = {"Binaries", "DerivedDataCache", "Intermediate", "Saved", ".git", ".agents", ".claude", ".codex", ".cursor", ".gemini", ".vscode"}
SCOPE_DIRS = [ROOT / "Content", ROOT / "Plugins", ROOT / "Source"]
EXT_CLASS = {
    ".uasset": "Unreal package (class unverified)", ".umap": "Unreal map (class unverified)",
    ".fbx": "3D source", ".obj": "3D source", ".gltf": "3D model", ".glb": "3D model",
    ".png": "image/texture candidate", ".jpg": "image/texture candidate", ".jpeg": "image/texture candidate",
    ".tga": "image/texture candidate", ".exr": "image/texture candidate", ".hdr": "image/texture candidate",
    ".wav": "audio", ".ogg": "audio", ".mp3": "audio", ".flac": "audio",
    ".cpp": "C++ source", ".h": "C++ source", ".cs": "C# build source", ".py": "Python source",
    ".json": "structured text", ".md": "documentation", ".txt": "text", ".ini": "configuration",
    ".uplugin": "plugin descriptor", ".uproject": "project descriptor",
}

def skipped(p):
    return any(part in SKIP for part in p.parts)

rows=[]
for base in SCOPE_DIRS:
    if not base.exists():
        continue
    for p in base.rglob("*"):
        if not p.is_file() or skipped(p):
            continue
        rel=p.relative_to(ROOT).as_posix()
        parts=Path(rel).parts
        if parts[0] == "Content":
            pack=parts[1] if len(parts)>1 else "Content-root"
            if pack in {"__ExternalActors__", "__ExternalObjects__"}:
                group="external-level payload (metadata only)"
                pack="/".join(parts[:2])
            else:
                if pack in {"Characters", "TopDown", "LevelPrototyping", "Cursor"}: group="UE template/demo"
                elif pack in {"Developers", "Collections"}: group="project/editor organization"
                else: group="added/custom content"
        elif parts[0] == "Plugins":
            group="plugin source/content"
            pack="/".join(parts[1:3]) if len(parts)>2 else "Plugins"
        else:
            group="project source"
            pack="Source"
        ext=p.suffix.lower() or "[no extension]"
        rows.append({"relative_path":rel,"ext":ext,"bytes":p.stat().st_size,"top_pack":pack,"classification":EXT_CLASS.get(ext,"other"),"confidence":"format/extension only" if ext in EXT_CLASS else "extension only","group":group})

with (OUT/"files.csv").open("w",newline="",encoding="utf-8-sig") as f:
    w=csv.DictWriter(f,fieldnames=["relative_path","ext","bytes","top_pack","classification","confidence","group"])
    w.writeheader(); w.writerows(sorted(rows,key=lambda r:r["relative_path"].casefold()))

byext=Counter(); bypack=defaultdict(lambda:{"files":0,"bytes":0}); bygroup=defaultdict(lambda:{"files":0,"bytes":0})
for r in rows:
    byext[r["ext"]]+=1
    bypack[r["top_pack"]]["files"]+=1; bypack[r["top_pack"]]["bytes"]+=r["bytes"]
    bygroup[r["group"]]["files"]+=1; bygroup[r["group"]]["bytes"]+=r["bytes"]
result={"source_root":str(ROOT),"method":"bounded read-only filesystem inventory; no Unreal editor/parser/export used; external actor/object payload included as path/extension/size metadata only","excluded_directory_names":sorted(SKIP),"scope_roots":[str(p) for p in SCOPE_DIRS],"total_files":len(rows),"total_bytes":sum(r["bytes"] for r in rows),"extension_counts":dict(sorted(byext.items())),"top_pack_counts":dict(sorted(bypack.items())),"group_counts":dict(sorted(bygroup.items())),"external_level_payload":{"files":sum(1 for r in rows if r["group"]=="external-level payload (metadata only)"),"bytes":sum(r["bytes"] for r in rows if r["group"]=="external-level payload (metadata only)"),"review":"deferred; paths and sizes only"},"asset_categories":{"unreal_packages_uasset_umap":sum(1 for r in rows if r["ext"] in {".uasset",".umap"}),"3d_exchange_sources":sum(1 for r in rows if r["ext"] in {".fbx",".obj",".gltf",".glb"}),"image_files":sum(1 for r in rows if r["ext"] in {".png",".jpg",".jpeg",".tga",".exr",".hdr"}),"audio_files":sum(1 for r in rows if r["ext"] in {".wav",".ogg",".mp3",".flac"}),"animation_or_rig_export_files":0,"note":"Zero means no corresponding loose exchange-format file was inventoried; binary Unreal package internals were not decoded."}}
prefixes=["NS_","NE_","BP_","BPI_","SM_","SK_","SKM_","A_","Anim","ABP_","T_","M_","MI_","DA_","SC_","SW_","WAV_","SVT_"]
result["filename_prefix_counts_inferred"]={pre:sum(1 for r in rows if r["ext"]==".uasset" and Path(r["relative_path"]).name.startswith(pre)) for pre in prefixes}
result["filename_prefix_note"]="Heuristic counts by package basename only; they suggest likely asset families but do not establish Unreal export class. Prefixes overlap (for example, animation may be A_ or Anim)."
(OUT/"inventory.json").write_text(json.dumps(result,indent=2,ensure_ascii=False),encoding="utf-8")
print(json.dumps({"total_files":len(rows),"total_bytes":result["total_bytes"],"extensions":result["extension_counts"],"packs":result["top_pack_counts"],"groups":result["group_counts"]},indent=2))
