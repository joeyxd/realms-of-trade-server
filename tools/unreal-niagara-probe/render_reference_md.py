"""Render the Spanish reference document of a system from its reference checkpoint.

python render_reference_md.py --checkpoint <reference-checkpoint.json> --out <REFERENCE.md>

Every number comes from the checkpoint (built by build_reference_checkpoint.py from the run folders);
the prose is fixed templates plus the hand-written notes below. The document has eight sections in
a fixed order. Output: UTF-8, LF, one trailing newline. Standard library only.
"""
import argparse
import json
import sys

SCHEMA = "st01c-reference-checkpoint/1"
SECTIONS = ("Comandos", "Ventana y semillas", "Encuadre", "Ráfaga y vida", "Dos ejecuciones", "Texturas",
            "Aceptado y no aceptado", "Pendiente")
ROLES = {"probe": "sondeo", "discarded": "descartada", "superseded": "sustituida",
         "blank-frame-attempt": "intento con fotograma en blanco", "final": "final"}
# Hand-written notes per run name (Spanish); a run without a note falls back to the checkpoint note.
NOTES = {
    "basichit-ref-probe01": "Bloque `capture` provisional del borrador (el mismo que el piloto).",
    "basichit-ref-probe02": "Cumple la regla de fotograma en blanco: se quitan el paso que falló y los siguientes. Los 241 estados de partículas sirven para derivar el encuadre.",
    "basichit-ref-probe03": "Con el encuadre recomendado; los archivos de partículas son idénticos a los de probe02 (el encuadre no toca la simulación).",
    "basichit-overlap01": "Pensada como la primera del par; por un error de proceso se lanzaron dos instancias de Unreal casi a la vez y los tiempos de pared se solaparon.",
    "basichit-overlap02": "Solapada con la anterior; las dos completaron y salieron iguales, pero se descartaron como evidencia (las carpetas se renombraron, sin borrar).",
    "basichit-reference01": "Primer par en serie a 512 px: el efecto ocupaba unos 80 px; se sustituye por el par a 1024 px.",
    "basichit-reference02": "Repetición de la anterior a 512 px; salió igual.",
    "basichit-blank-attempt01": "Primer intento con el nombre `basichit-reference03` (por eso se renombró la carpeta y la consola tras fallar).",
}
TEXTURE_USE = (
    ("T_FireBall", "sí",
     "`MI_Fireball` (Flame, 8x4 SubUV) la fija como parámetro (material-defaults.json:154); además es el valor por defecto del padre `M_Smoke` (material-defaults.json:39)."),
    ("T_Hit_Circle", "sí",
     "`MI_Hit_1` (Flash, 1x1) la fija sobre su padre `M_Ground_Crack` (material-defaults.json:184)."),
    ("T_FlameUV_1", "no",
     "La fija `MI_Flame_1` (material-defaults.json:169), que ningún renderer activo usa (EXTRACTION.md:16-18; solo aparece en system.t3d:2493)."),
    ("T_Ground_Crack", "no",
     "Es el valor por defecto del padre `M_Ground_Crack` (material-defaults.json:120) y `MI_Hit_1` lo sustituye por `T_Hit_Circle`."),
)
CAMERA_ORDER = ("front", "oblique", "side")


def num(value, digits=1):
    return ("%." + str(digits) + "f") % value


def vec(values, digits=1):
    return "(" + ", ".join(num(v, digits) for v in values) + ")"


def steps_text(steps):
    return "[" + ", ".join(str(step) for step in steps) + "]"


def frame_text(framing):
    return "objetivo %s, distancia %g, ancho %g" % (
        steps_text(framing["cameraTarget"]), framing["cameraDistance"], framing["orthoWidth"])


def short(digest):
    return digest[:8] + "…" + digest[-4:]


def camera_line(cameras):
    return ", ".join("%s %s/%s" % (name, num(cameras[name]["maxAbsRight"]), num(cameras[name]["maxAbsUp"]))
                     for name in CAMERA_ORDER if name in cameras)


def render(data):
    settings, framing, repeat, burst = data["settings"], data["framing"], data["repeat"], data["burst"]
    counts, runs, blanks = data["counts"], data["captureRuns"], data["blankFrameAttempts"]
    ref, rep_run = data["referenceRun"], repeat["runB"]
    spec = data["system"]["spec"]
    size, steps = settings["imageSize"], settings["imageSteps"]
    spec_path = spec["file"]
    by_name = {row["name"]: row for row in runs}
    finals = [row for row in runs if row["role"] == "final"]
    earlier = [row for row in runs if row["role"] != "final"]
    ordered = earlier + finals
    cameras = settings["cameras"]
    seeds = data["seedConfiguration"]
    last_any = data["effectLastStepAlive"]
    alive = data["aliveAtSteps"]
    visible = data["visiblePixelsGt16"]
    out = []
    add = out.append

    add("# NS_BasicHit: referencia Unreal")
    add("")
    add("Captura de referencia de `NS_BasicHit` (UE %s, proyecto aislado `.scratch/unreal/ST01c_Pilot.uproject`) con las herramientas por especificación" % data["engine"].split("-")[0])
    add("(T-1020-101). Sistema `%s`, SHA-256 de la fuente `%s`. Especificación" % (data["system"]["package"], short(data["system"]["sourceSystemSha256"])))
    add("`%s` (SHA-256 `%s`). La auditoría legible por máquina es" % (spec_path, short(spec["sha256"])))
    add("[reference-checkpoint.json](reference-checkpoint.json) (`python tools/unreal-niagara-probe/check_reference_checkpoint.py` la reverifica; este documento se regenera con")
    add("`tools/unreal-niagara-probe/render_reference_md.py`). Las carpetas de ejecución siguen en `.scratch/unreal` (fuera de git) y el checkpoint las fija por hash.")
    add("")

    # Comandos
    add("## " + SECTIONS[0])
    add("Todas las ejecuciones de Unreal usan la misma línea (UnrealEditor-Cmd por PowerShell, en primer plano, una instancia a la vez) con otro `-CaptureRun`; la consola va a")
    add("`.scratch/unreal/<nombre>-console.log`. Los tiempos son de pared, de `Stopwatch` alrededor del comando.")
    add("")
    add("```powershell")
    add("& 'C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe' 'C:/DEV/real of trade/st01c-native/.scratch/unreal/ST01c_Pilot.uproject' -d3d11 -RenderOffscreen -unattended -nop4 -nosplash -nosound '-ExecCmds=Automation RunTests Editor.Python.ST01c_Pilot.test_st01c_reference' '-TestExit=Automation Test Queue Empty' -CaptureRun=<nombre> '-SystemSpec=C:/DEV/real of trade/st01c-native/%s'" % spec_path)
    add("```")
    add("")
    add("Ejecuciones de Unreal, en orden (%d):" % len(ordered))
    for index, row in enumerate(ordered, 1):
        note = NOTES.get(row["name"], row.get("note", ""))
        framing_row = row.get("framing")
        text = "%d. `%s` (%s s, %s): " % (index, row["name"], num(row["wallSeconds"]), ROLES.get(row["role"], row["role"]))
        if row.get("imageSize"):
            text += "%d², pasos de imagen %s, " % (row["imageSize"], steps_text(row["imageSteps"]))
        if framing_row:
            text += "%s. " % frame_text(framing_row)
        text += "Resultado: %s." % row["outcome"]
        if note:
            text += " " + note
        add(text)
    add("")
    add("Después de la última ejecución:")
    add("1. `python -B tools/unreal-niagara-probe/compare_reference_runs.py --spec %s --a .scratch/unreal/%s --b .scratch/unreal/%s`" % (spec_path, ref, rep_run))
    add("2. `python -B tools/unreal-niagara-probe/frame_from_particles.py --spec %s --run .scratch/unreal/%s`" % (spec_path, ref))
    add("3. El pin de `ns-basichit.json` en `source-export-manifest.json` se sustituyó en el sitio por el SHA-256 del spec final y se comprobó byte a byte contra una regeneración con `python -B tools/unreal-niagara-probe/build_export_manifest.py` y los argumentos de EXTRACTION.md (ver Pendiente).")
    add("4. `python -B tools/unreal-niagara-probe/build_reference_checkpoint.py --spec %s --a .scratch/unreal/%s --b .scratch/unreal/%s --out docs/delivery/st01c/basichit/reference-checkpoint.json`" % (spec_path, ref, rep_run))
    add("5. `python -B tools/unreal-niagara-probe/render_reference_md.py --checkpoint docs/delivery/st01c/basichit/reference-checkpoint.json --out docs/delivery/st01c/basichit/REFERENCE.md`")
    add("6. `python -B tools/unreal-niagara-probe/check_reference_checkpoint.py docs/delivery/st01c/basichit/reference-checkpoint.json --root .`")
    add("")
    add("Fotogramas en blanco (la compuerta de `capture_reference.py` exige al menos 100 píxeles visibles en cada paso de imagen posterior al 0; no informa el recuento):")
    for row in blanks:
        add("- `%s`: paso %d / %s a %d²; acción: se quitan ese paso y los siguientes de `capture.imageSteps`." % (
            row["run"], row["failingStep"], row["camera"], row["imageSize"] or 0))
    add("")

    # Ventana y semillas
    add("## " + SECTIONS[1])
    provisional = by_name["basichit-ref-probe01"]["imageSteps"]
    dropped = [step for step in provisional if step not in steps]
    add("Ventana del spec: dt 1/%d s, `lastStep` %d (estados 0 a %d, %g s), estado 0 antes del primer avance (vacío, 0 partículas en los tres emisores)." % (
        round(1.0 / settings["dt"]), settings["lastStep"], settings["lastStep"], settings["lastStep"] * settings["dt"]))
    add("Imágenes en los pasos %s (más la base del paso 0 con la primera cámara, %d PNG), HDR lineal en el paso %d (%d archivos)," % (
        steps_text(steps), counts["images"], settings["linearStep"], counts["hdr"]))
    add("%d², cámaras ortográficas %s. Pasos %s del borrador quedaron fuera (ver Ráfaga y vida y Pendiente)." % (
        size, ", ".join("`%s` %g/%g" % (c["name"], c["yaw"], c["pitch"]) for c in cameras),
        ", ".join(str(step) for step in dropped)))
    add("Semillas (`fixtureSeedBase` %d, fixture en memoria; los emisores originales tienen determinismo falso y semilla 0): %s. Las dos ejecuciones finales usan las mismas." % (
        seeds["fixtureSeedBase"], ", ".join("`%s` %d" % (h["name"], h["seed"]) for h in seeds["handles"])))
    add("")

    # Encuadre
    add("## " + SECTIONS[2])
    box, first = framing["box"], framing["firstPass"]
    spec_frame = framing["specFraming"]
    add("Regla (`frame_from_particles.py`): caja alineada a los ejes de todas las posiciones de partículas de los %d pasos (%d registros), ampliada en la mitad" % (
        framing["particleSteps"], framing["particleRecords"]))
    add("del mayor tamaño de sprite (%s cm) en cada eje. Debe caber en el cuadro ortográfico de cada cámara con margen del 10 %% (esquinas dentro del 90 %% del medio ancho)." % num(framing["largestSpriteSize"], 2))
    add("")
    add("- Caja: x %s a %s, y %s a %s, z %s a %s; centro %s; extensión %s cm." % (
        num(box["min"][0]), num(box["max"][0]), num(box["min"][1]), num(box["max"][1]), num(box["min"][2]), num(box["max"][2]),
        vec(box["center"]), vec(box["extent"])))
    first_frame = first["specFraming"]
    rec = first["recommendation"]
    add("- Primera pasada (`%s`, objetivo %s, distancia %g, ancho %g, límite %s cm): `fits: false`. Máximos |derecha|/|arriba| por cámara: %s cm." % (
        first["run"], steps_text(first_frame["cameraTarget"]), first_frame["cameraDistance"], first_frame["orthoWidth"],
        num(first_frame["limitCm"]), camera_line(first["cameras"])))
    add("- Recomendación de la herramienta: objetivo %s (centro redondeado a 10 cm), ancho %g, distancia %g." % (
        steps_text(rec["cameraTarget"]), rec["orthoWidth"], rec["cameraDistance"]))
    add("  La regla base daba ancho %g (1.2 x la mayor extensión, múltiplo de 50), pero la cámara oblicua deja esquinas fuera del 90 %% con ese ancho" % rec["orthoWidthFromExtent"])
    add("  (máximos %s/%s cm frente a %s cm). Por eso la herramienta también sube el ancho hasta que toda esquina proyectada cabe en el 90 %%: %g cm." % (
        num(framing["cameras"]["oblique"]["maxAbsRight"]), num(framing["cameras"]["oblique"]["maxAbsUp"]),
        num(0.9 * rec["orthoWidthFromExtent"] / 2.0), rec["orthoWidth"]))
    add("  La ampliación (el ancho también por esquinas proyectadas) es una decisión confirmada del encargo; la base 1.2 x se conserva en `orthoWidthFromExtent`.")
    applied = framing["applied"]
    add("- Aplicado: objetivo %s, distancia %g, ancho %g. Resultado sobre la ejecución final: `fits: %s` (%s cm; límite %s cm)." % (
        steps_text(applied["cameraTarget"]), applied["cameraDistance"], applied["orthoWidth"],
        "true" if framing["fits"] else "false", camera_line(framing["cameras"]), num(spec_frame["limitCm"])))
    extent12 = data["visibleExtentPx"]
    at_linear = ["t%04d_%s.png" % (settings["linearStep"], name) for name in CAMERA_ORDER]
    px = [extent12[name] for name in at_linear if name in extent12]
    add("- Resolución: %s cm por píxel (ancho %g / %d px). El efecto visible en el paso %d ocupa %s px (ancho x alto, por cámara) de %d." % (
        num(data["cmPerPixel"], 3), applied["orthoWidth"], size, settings["linearStep"],
        ", ".join("%dx%d" % tuple(p) for p in px), size))
    high_name = max(visible, key=lambda n: visible[n])
    after0 = {n: v for n, v in visible.items() if "t0000_" not in n}
    low_name = min(after0, key=lambda n: after0[n])
    add("- Píxeles visibles (>16) entre los pasos de imagen posteriores al 0: de %d (%s) a %d (%s); el umbral de la compuerta es 100." % (
        after0[low_name], low_name, visible[high_name], high_name))
    add("")

    # Ráfaga y vida
    add("## " + SECTIONS[3])
    add("Lo que muestran los archivos de partículas de `%s` (`uniqueId` marca los nacimientos):" % ref)
    add("")
    add("| emisor | primer paso con partículas | partículas en ese paso | máximo vivas | último paso vivo | vida mín a máx (s) | tamaño sprite mín a máx (cm) | nacimientos tras el paso 60 |")
    add("|---|---|---|---|---|---|---|---|")
    for name in ("NE_Flame_Basic_001", "NE_Basic_Flash001", "NE_SimpleBurst"):
        row = burst[name]
        add("| `%s` | %d | %d | %d | %d | %s a %s | %s a %s | %s |" % (
            name, row["firstStep"], row["countAtFirstStep"], row["maxAlive"], row["lastStepAlive"],
            num(row["lifetimeMin"], 4), num(row["lifetimeMax"], 4), num(row["spriteSizeMin"], 2), num(row["spriteSizeMax"], 2),
            "sí" if row["birthsAfterStep60"] else "no"))
    add("")
    births = {name: burst[name]["birthSteps"] for name in burst}
    one_step = all(len(v) == 1 for v in births.values())
    first_steps = sorted({burst[name]["firstStep"] for name in burst})
    add("- Esperado por el script compilado (EXTRACTION.md): ráfagas instantáneas con tiempo 0. Los archivos lo confirman: los emisores nacen en el paso %s con %s partículas y el paso 0 tiene 0." % (
        "/".join(str(s) for s in first_steps), ", ".join(str(burst[name]["countAtFirstStep"]) for name in ("NE_Flame_Basic_001", "NE_Basic_Flash001", "NE_SimpleBurst"))))
    add("  Nacimientos por emisor: %s%s." % (
        "; ".join("`%s` en los pasos %s" % (name, births[name]) for name in births),
        " (un único paso cada uno; el `SpawnRate` del Flame, de estado desconocido en la extracción, no produjo ningún nacimiento posterior)" if one_step else ""))
    add("- Vidas: Flash %s s y Flame %s s, constantes (el Flame no estaba resuelto en la extracción: ahora observado); SimpleBurst entre %s y %s s (aleatoria por partícula)." % (
        num(burst["NE_Basic_Flash001"]["lifetimeMin"], 1), num(burst["NE_Flame_Basic_001"]["lifetimeMin"], 1),
        num(burst["NE_SimpleBurst"]["lifetimeMin"], 4), num(burst["NE_SimpleBurst"]["lifetimeMax"], 4)))
    add("- El último paso con alguna partícula viva es el %d (%s s); del %d al %d no hay partículas, el efecto dura unos %s s de los %g s capturados." % (
        last_any, num(last_any * settings["dt"], 3), last_any + 1, settings["lastStep"], num(last_any * settings["dt"], 1),
        settings["lastStep"] * settings["dt"]))
    add("- Partículas vivas de SimpleBurst en los pasos de imagen y en los pasos que fallaron: %s." % ", ".join(
        "paso %s: %d" % (step, alive[step]["NE_SimpleBurst"]) for step in sorted(alive, key=int)))
    failing = sorted({row["failingStep"] for row in blanks})
    last_image = max(steps)
    add("- El paso %s sale en blanco (la compuerta exige 100 píxeles visibles) en %s, aunque en ese paso quedan %d partículas del SimpleBurst (tamaño máximo de sprite en toda la captura %s cm); el paso %d, con %d partículas, aún da %d píxeles visibles (t%04d_front.png)." % (
        "/".join(str(s) for s in failing), " y ".join("`%s`" % row["run"] for row in blanks),
        alive[str(failing[0])]["NE_SimpleBurst"], num(burst["NE_SimpleBurst"]["spriteSizeMax"], 2),
        last_image, alive[str(last_image)]["NE_SimpleBurst"], visible["frames/t%04d_front.png" % last_image], last_image))
    add("  Por la regla fijada, `imageSteps` termina en %d; los pasos %d a %d solo existen como partículas." % (last_image, last_image + 1, last_any))
    add("")

    # Dos ejecuciones
    add("## " + SECTIONS[4])
    png_rows = repeat["ldrDecodedPixelDifferences"]
    png_max = max(row["maxChannelDifference"] for row in png_rows)
    add("`compare_reference_runs.py` sobre `%s` y `%s` (código de salida %d):" % (ref, rep_run, 0 if repeat["result"] == "equal" else 1))
    add("")
    add("```")
    add("particles %d/%d identical" % (repeat["cpuFramesIdentical"], repeat["cpuFramesExpected"]))
    add("hdr %d/%d identical" % (repeat["hdrFilesByteIdentical"], repeat["hdrFilesExpected"]))
    add("png %d/%d within 0 (max difference %d)" % (sum(1 for row in png_rows if row["maxChannelDifference"] <= 0), len(png_rows), png_max))
    add("textures %d/%d equal" % (repeat["texturesEqual"], repeat["texturesExpected"]))
    keys = repeat["reportKeysEqual"]
    add("report " + ", ".join("%s %s" % (k, "equal" if keys[k] else "DIFFERENT") for k in sorted(keys, key=("settings", "seed_configuration", "counts").index)) + "")
    add("RESULT " + repeat["result"])
    add("```")
    add("")
    add("Los %d estados de CPU y los %d HDR coinciden byte a byte; los %d PNG coinciden en píxeles decodificados (los bytes PNG pueden diferir por metadatos). El umbral es el del piloto (0)." % (
        repeat["cpuFramesIdentical"], repeat["hdrFilesByteIdentical"], len(png_rows)))
    add("`capture-report.json` difiere entre ejecuciones por las marcas de tiempo y los sha256 de los PNG; solo se comparan `settings`, `seed_configuration` y `counts`.")
    add("")

    # Texturas
    add("## " + SECTIONS[5])
    add("Las cuatro exportadas por `TextureExporterPNG` y fijadas (ancho x alto, sRGB, SHA-256 del PNG y del paquete copiado, este último el de [source-copy-audit.json](source-copy-audit.json)):")
    add("")
    add("| textura | tamaño | sRGB | sha256 del PNG | sha256 del paquete copiado |")
    add("|---|---|---|---|---|")
    for row in data["textureExports"]:
        add("| `%s` | %dx%d | %s | `%s` | `%s` |" % (row["asset"].rsplit("/", 1)[1], row["width"], row["height"],
                                                     "sí" if row["srgb"] else "no", row["sha256"], row["source_copy_package_sha256"]))
    add("")
    add("Cuáles alimentan un renderer activo (según [material-defaults.json](material-defaults.json) y [EXTRACTION.md](EXTRACTION.md)):")
    for name, active, why in TEXTURE_USE:
        add("- `%s`: %s. %s" % (name, active, why))
    add("- `MI_Radial_2` (SimpleBurst) no tiene textura: sus %d partículas no usan ninguna de las cuatro." % burst["NE_SimpleBurst"]["maxAlive"])
    add("")

    # Aceptado
    add("## " + SECTIONS[6])
    add("Aceptado:")
    add("- La igualdad de las dos ejecuciones finales en la ventana, semillas y encuadre del spec (partículas, HDR, PNG por píxeles, texturas, claves del informe).")
    add("- Los pins: SHA-256 de %d archivos de `%s`, de las %d texturas y sus paquetes copiados, de los %d archivos de código y del spec (`check_reference_checkpoint.py`), y el pin de `ns-basichit.json` en `source-export-manifest.json`." % (
        counts["referenceFiles"], ref, len(data["textureExports"]), len(data["codeHashes"])))
    add("- Los hechos de ráfaga y vida de la tabla anterior, como observación de esta captura.")
    add("")
    add("No aceptado:")
    add("- Nada sobre fidelidad visual: `visual_acceptance` sigue en falso; los PNG son FinalColorLDR y los HDR descartan alfa.")
    add("- El encuadre como arte final: sale de una regla sobre cajas y deja el efecto pequeño.")
    add("- El port nativo, su simulación y cualquier comparación con el laboratorio de Three.js.")
    add("- Las imágenes después del paso %d (la cola del efecto, pasos %d a %d, no tiene PNG de referencia)." % (last_image, last_image + 1, last_any))
    add("")

    # Pendiente
    add("## " + SECTIONS[7])
    add("- El hash de `ns-basichit.json` se calcula sobre el archivo de trabajo, con CRLF en este checkout (`core.autocrlf`); en otro checkout con LF el hash del spec no coincidiría hasta renormalizar.")
    add("- El encuadre no es arte final: la regla usa todas las partículas de todos los pasos y, con la ráfaga de %d partículas dispersas, la caja resulta mucho mayor que el cuerpo visible. Decidir si se quiere un encuadre por percentiles o por pasos de imagen." % burst["NE_SimpleBurst"]["maxAlive"])
    add("- Los pasos posteriores al %d no tienen imagen: el paso %s sale en blanco a %d² con el encuadre final (ver Ráfaga y vida). Cubrirlos exigiría un encuadre propio de la cola; la regla del encargo los deja fuera." % (
        last_image, "/".join(str(s) for s in failing), size))
    add("- Los pasos %d a %d no tienen partículas (el efecto termina en el paso %d): no se capturan imágenes ahí, serían negras y la compuerta las rechazaría." % (
        last_any + 1, settings["lastStep"], last_any))
    add("- `frame_from_particles.py` amplía la regla base (ancho también por esquinas proyectadas); está confirmada en el encargo, pero queda por fijarla en la documentación del flujo común.")
    add("- `SpawnRate` del Flame: sin nacimientos tras el paso 1 en esta captura; el estado habilitado del módulo sigue sin confirmar en la fuente.")
    add("- Los %d HDR del paso %d son la única referencia lineal; no hay HDR de otros pasos." % (counts["hdr"], settings["linearStep"]))
    add("- Texturas `T_FlameUV_1` y `T_Ground_Crack` exportadas pero sin uso activo; la tarea 05 (primitivas comunes) decide si se necesitan.")
    add("- Las carpetas de las ejecuciones sustituidas (a 512 px) y descartadas siguen en `.scratch/unreal` sin pin; solo `%s` y `%s` son la evidencia." % (ref, rep_run))
    return "\n".join(out) + "\n"


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    try:
        with open(args.checkpoint, "r", encoding="utf-8") as stream:
            data = json.load(stream)
        if data.get("schema") != SCHEMA:
            raise ValueError("schema is not " + SCHEMA)
        text = render(data)
    except (OSError, ValueError, KeyError, TypeError) as error:
        print("ERROR %s" % error, file=sys.stderr)
        return 2
    with open(args.out, "w", encoding="utf-8", newline="\n") as stream:
        stream.write(text)
    print("wrote %s (%d sections)" % (args.out, text.count("\n## ")))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
