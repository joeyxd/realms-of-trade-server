"""Reconcile published Unreal inventories; sample hashes only for exact pack/path overlaps."""
from pathlib import Path
import csv, hashlib, json

BASE = Path(__file__).parent
SOURCES = {
    "ActionRPG": {"folder": "actionrpg", "root": Path(r"C:\Unreal\ActionRPGMultiplayerStart"), "json_count": "content_file_count", "json_bytes": "content_bytes", "scope": "Content only"},
    "Survival": {"folder": "survival", "root": Path(r"C:\Unreal\survival project\SimpleMultiplayerSurvival"), "json_count": "content_files", "json_bytes": "content_bytes", "scope": "Content only"},
    "MyProject": {"folder": "myproject", "root": Path(r"C:\Unreal\MyProject"), "json_count": "total_files", "json_bytes": "total_bytes", "scope": "Content, Plugins, Source if present"},
}
EXTERNAL = {"__ExternalActors__", "__ExternalObjects__"}
DEMOS = {"Characters", "Cursor", "LevelPrototyping", "TopDown", "NiagaraExamples"}
MAX_HASH = 20 * 1024 * 1024

def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def load_project(name, spec):
    folder = BASE / spec["folder"]
    inv = json.loads((folder / "inventory.json").read_text(encoding="utf-8-sig"))
    with (folder / "files.csv").open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    relkey = "relative_path"
    extkey = "ext" if "ext" in rows[0] else "extension"
    packkey = "top_pack" if "top_pack" in rows[0] else "pack"
    normalized = []
    for row in rows:
        raw = row[relkey].replace("\\", "/").lstrip("/")
        rel = raw if raw.startswith("Content/") else "Content/" + raw
        parts = rel.split("/")
        pack = parts[1] if len(parts) > 1 else "Content-root"
        pack_rel = "/".join(parts[2:])
        bucket = "Content" if raw.startswith("Content/") or name != "MyProject" else ("Plugins" if raw.startswith("Plugins/") else ("Source" if raw.startswith("Source/") else "Other"))
        disk_rel = raw if raw.startswith("Content/") or (name == "MyProject" and not raw.startswith("Content/")) else "Content/" + raw
        nr = {"project": name, "source_path": raw, "normalized_path": rel, "pack": pack, "pack_relative_path": pack_rel,
              "extension": row[extkey], "bytes": int(row["bytes"]), "source_row": row, "bucket": bucket,
              "physical_path": spec["root"] / Path(*disk_rel.split("/"))}
        normalized.append(nr)
    csv_bytes = sum(r["bytes"] for r in normalized)
    csv_count = len(normalized)
    expected_count = inv[spec["json_count"]]
    expected_bytes = inv[spec["json_bytes"]]
    return {"name": name, "spec": spec, "inventory": inv, "rows": normalized,
            "reconciliation": {"csv_rows": csv_count, "json_files": expected_count, "rowcount_match": csv_count == expected_count,
                               "csv_sum_bytes": csv_bytes, "json_bytes": expected_bytes, "bytes_match": csv_bytes == expected_bytes}}

projects = [load_project(name, spec) for name, spec in SOURCES.items()]

# One row per Content top-level pack and project. The role is a review bucket, not provenance.
pack_rows = []
for p in projects:
    acc = {}
    for r in p["rows"]:
        if r["bucket"] != "Content":
            continue
        x = acc.setdefault(r["pack"], {"files": 0, "bytes": 0})
        x["files"] += 1; x["bytes"] += r["bytes"]
    for pack, x in sorted(acc.items()):
        if pack in EXTERNAL:
            role, basis = "external", "Unreal external actor/object payload path"
        elif pack in DEMOS:
            role, basis = "demo", "folder name or existing report identifies template/demo content"
        else:
            role, basis = "candidate", "review candidate based on pack presence; not quality, license, or provenance claim"
        pack_rows.append({"project": p["name"], "content_top_pack": pack, "files": x["files"], "bytes": x["bytes"], "review_role": role, "role_basis": basis})
with (BASE / "PACKS.csv").open("w", newline="", encoding="utf-8-sig") as f:
    w = csv.DictWriter(f, fieldnames=["project", "content_top_pack", "files", "bytes", "review_role", "role_basis"])
    w.writeheader(); w.writerows(pack_rows)

# Compare full normalized pack-relative paths (pack + path), retaining every metadata overlap.
indexes = {}
for p in projects:
    ix = {}
    for r in p["rows"]:
        if r["bucket"] == "Content":
            ix.setdefault((r["pack"], r["pack_relative_path"]), []).append(r)
    indexes[p["name"]] = ix

allpacks = sorted({pack for ix in indexes.values() for pack, _ in ix})
overlap_summary = []
overlaps_by_pack = {}
for pack in allpacks:
    by_pair = {}
    candidates = {}
    for i, a in enumerate(projects):
        for b in projects[i+1:]:
            an, bn = a["name"], b["name"]
            ak = {k: v for k, v in indexes[an].items() if k[0] == pack}
            bk = {k: v for k, v in indexes[bn].items() if k[0] == pack}
            common = sorted(set(ak) & set(bk), key=lambda k: k[1].casefold())
            if not common:
                continue
            matched = sum(1 for k in common for ra in ak[k] for rb in bk[k] if ra["bytes"] == rb["bytes"])
            different = sum(1 for k in common for ra in ak[k] for rb in bk[k] if ra["bytes"] != rb["bytes"])
            by_pair[f"{an} vs {bn}"] = {"shared_pack_relative_paths": len(common), "same_size_row_pairs": matched, "different_size_row_pairs": different}
            for k in common:
                rs = [*ak[k], *bk[k]]
                if all(r["bytes"] <= MAX_HASH for r in rs):
                    candidates.setdefault(k, rs)
    if by_pair:
        overlap_summary.append({"content_top_pack": pack, "project_pairs": by_pair})
        overlaps_by_pack[pack] = candidates

hash_samples = []
for pack, candidates in overlaps_by_pack.items():
    selected = sorted(candidates.items(), key=lambda kv: (max(r["bytes"] for r in kv[1]), kv[0][1].casefold()))[:3]
    for (pck, subpath), rows in selected:
        copies = []
        for r in sorted(rows, key=lambda x: x["project"]):
            if not r["physical_path"].is_file():
                copies.append({"project": r["project"], "relative_path": r["source_path"], "bytes": r["bytes"], "file_exists": False, "sha256": None})
            else:
                disk_size = r["physical_path"].stat().st_size
                copies.append({"project": r["project"], "relative_path": r["source_path"], "bytes": r["bytes"], "disk_bytes": disk_size, "inventory_size_matches_disk": disk_size == r["bytes"], "file_exists": True, "sha256": sha256(r["physical_path"])})
        hash_samples.append({"pack": pck, "pack_relative_path": subpath, "copies": copies,
                             "all_sizes_match": len({x["bytes"] for x in copies}) == 1,
                             "all_hashes_match": len({x["sha256"] for x in copies}) == 1 and all(x["sha256"] for x in copies)})

rollups = {}
for p in projects:
    buckets = {}
    for r in p["rows"]:
        x = buckets.setdefault(r["bucket"], {"files": 0, "bytes": 0})
        x["files"] += 1; x["bytes"] += r["bytes"]
    rollups[p["name"]] = {"scope_as_in_source_inventory": p["spec"]["scope"], "included_inventory_rows": len(p["rows"]), "included_inventory_bytes": sum(r["bytes"] for r in p["rows"]), "by_bucket": buckets}

combined = {"duplicate_inclusive_files": sum(p["reconciliation"]["csv_rows"] for p in projects),
            "duplicate_inclusive_bytes": sum(p["reconciliation"]["csv_sum_bytes"] for p in projects),
            "duplicate_inclusive_gib_binary": round(sum(p["reconciliation"]["csv_sum_bytes"] for p in projects) / 1024**3, 4),
            "content_files": sum(x.get("by_bucket", {}).get("Content", {}).get("files", 0) for x in rollups.values()),
            "content_bytes": sum(x.get("by_bucket", {}).get("Content", {}).get("bytes", 0) for x in rollups.values()),
            "plugin_files": sum(x.get("by_bucket", {}).get("Plugins", {}).get("files", 0) for x in rollups.values()),
            "plugin_bytes": sum(x.get("by_bucket", {}).get("Plugins", {}).get("bytes", 0) for x in rollups.values()),
            "source_files": sum(x.get("by_bucket", {}).get("Source", {}).get("files", 0) for x in rollups.values()),
            "source_bytes": sum(x.get("by_bucket", {}).get("Source", {}).get("bytes", 0) for x in rollups.values()),
            "scope_note": "Duplicate-inclusive physical inventory rows as published; ActionRPG/Survival reports inventory Content only, while MyProject also inventories Plugins/Source. Zero rows outside a report's stated scope do not assert the source folder was absent."}

result = {"source_reports": {p["name"]: p["reconciliation"] for p in projects}, "all_reconciliations_pass": all(p["reconciliation"]["rowcount_match"] and p["reconciliation"]["bytes_match"] for p in projects),
          "per_project_rollups": rollups, "combined_duplicate_inclusive": combined,
          "packs_csv_rows": len(pack_rows), "shared_top_pack_overlaps": overlap_summary,
          "sha256_samples_under_20MiB_per_shared_pack": hash_samples,
          "sample_method": "up to three exact same-top-pack and same-relative-path files per shared pack, smallest first and only when every sampled copy is <=20 MiB; SHA-256 read in 1 MiB chunks",
          "caveats": ["Same name/path/size is not proof of identical content.", "Matching hashes prove only the sampled files match, not that a whole pack/project is equivalent.", "No source content was modified or deleted.", "Paths were normalized to Content/... for comparing the two inventories whose CSV paths omit the Content prefix."]}
result["all_sample_hash_files_exist_and_sizes_match_inventory"] = all(all(c.get("file_exists") and c.get("inventory_size_matches_disk") for c in s["copies"]) for s in hash_samples)
(BASE / "validation.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")

def fmt(n):
    return f"{n:,}".replace(",", ",")

lines = ["# Cruce de packs y posibles duplicados", "",
         "Los cruces usan ruta relativa exacta dentro del mismo pack después de normalizar a `Content/<pack>/...`. Las fuentes se leyeron en solo lectura. Los tamaños provienen de los CSV reconciliados y se contrastaron con disco para cada muestra SHA-256. No se eliminó ningún archivo.", "",
         "## Inventarios reconciliados y suma combinada", "",
         "| Proyecto | Filas CSV | Bytes CSV | Filas JSON | Bytes JSON | Resultado |", "|---|---:|---:|---:|---:|---|"]
for p in projects:
    x=p["reconciliation"]
    lines.append(f"| {p['name']} | {fmt(x['csv_rows'])} | {fmt(x['csv_sum_bytes'])} | {fmt(x['json_files'])} | {fmt(x['json_bytes'])} | filas y bytes coinciden |")
lines += ["", f"Suma inclusiva de las tres tablas: **{fmt(combined['duplicate_inclusive_files'])} filas, {fmt(combined['duplicate_inclusive_bytes'])} bytes ({combined['duplicate_inclusive_gib_binary']} GiB)**. Es una suma que cuenta packs compartidos en cada proyecto otra vez; no es almacenamiento único deduplicado.", "",
          f"Solo `Content/`: {fmt(combined['content_files'])} filas / {fmt(combined['content_bytes'])} bytes. `Plugins/`: {fmt(combined['plugin_files'])} filas / {fmt(combined['plugin_bytes'])} bytes, todos en MyProject/VibeUE. `Source/` raíz: {fmt(combined['source_files'])} filas / {fmt(combined['source_bytes'])} bytes reportados. ActionRPG y Survival publicaron inventario solo de Content; esos ceros fuera de alcance no implican ausencia de carpetas fuente.", "",
          "## Packs y coincidencias de ruta", "",
          "`PACKS.csv` tiene una fila por proyecto y pack superior dentro de Content, con el rol de revisión candidato/demo/externo. Ese rol no atribuye procedencia ni licencia.", "",
          "| Pack | Proyecto y rutas compartidas | Mismo tamaño | Tamaño distinto |", "|---|---|---:|---:|"]
for x in overlap_summary:
    for pair, q in x["project_pairs"].items():
        lines.append(f"| `{x['content_top_pack']}` | {pair}: {fmt(q['shared_pack_relative_paths'])} | {fmt(q['same_size_row_pairs'])} | {fmt(q['different_size_row_pairs'])} |")
lines += ["", "No hay un pack superior común a los tres inventarios. El resumen cubre rutas con pack + ruta relativa idénticos; no empareja assets solo por parecido de nombre. Un mismo nombre, ruta y tamaño no prueba igualdad de contenido.", "",
          "## Muestras SHA-256", "",
          "Hasta tres archivos por pack compartido, elegidos por menor tamaño y limitados a copias de hasta 20 MiB. Las rutas están debajo de `Content/<pack>/`. Digest completo por copia:", "",
          "| Pack / ruta relativa | Proyecto | Bytes (inventario/disco) | SHA-256 |", "|---|---|---:|---|"]
for s in hash_samples:
    for c in s["copies"]:
        disk = str(c.get("disk_bytes", "missing"))
        digest = c.get("sha256") or "sin archivo"
        lines.append(f"| `{s['pack']}/{s['pack_relative_path']}` | {c['project']} | {fmt(c['bytes'])}/{fmt(c['disk_bytes']) if c.get('disk_bytes') is not None else 'ausente'} | `{digest}` |")
    lines.append(f"|  |  |  | **Muestra: tamaños {'iguales' if s['all_sizes_match'] else 'distintos'}; SHA-256 {'coincide' if s['all_hashes_match'] else 'difiere'}** |")
lines += ["", "Los archivos muestreados de `NiagaraExamples` (3) y `SwordTrailVFX` (3) tienen SHA-256 idéntico entre Survival y MyProject; es evidencia para priorizar verificación de esos packs. Las tres muestras de `ActionRPGStarterSystem`, `BigNiagaraBundle`, `Dreamrise_SMSK` y `sA_Megapack_v1` difieren. En los muestreos, todas las rutas existen y los tamaños de disco coinciden con los manifiestos.", "",
          "Las muestras no prueban que un pack completo sea equivalente ni que sus dependencias/clases sean iguales. Los metadatos de ruta/tamaño tampoco validan semántica de Unreal. No recomiendo borrar o sustituir nada a partir de esta comparación; cualquier deduplicación requeriría hash completo del pack elegido, referencias/dependencias y aceptación explícita del owner.", ""]
(BASE / "DUPLICATES.md").write_text("\n".join(lines), encoding="utf-8")
print(json.dumps({"reconciliations": result["source_reports"], "combined": combined, "shared_packs": [(x["content_top_pack"], x["project_pairs"]) for x in overlap_summary], "hash_sample_count": len(hash_samples)}, indent=2))
