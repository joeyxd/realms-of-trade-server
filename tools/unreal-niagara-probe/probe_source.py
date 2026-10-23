"""Read-only source extraction probe, restricted to this isolated scratch project.

Command line: -SystemSpec=<absolute systems/*.json> -ProbeRun=<fresh name>.
Writes <project>/<ProbeRun>/ (report.json plus one .t3d per exported object).
"""
import hashlib
import json
import os
import re
import traceback
import unreal


def command_line_value(name):
    """Value of -name=... from the command line; handles a whole-argument quote and spaces."""
    line = unreal.SystemLibrary.get_command_line()
    match = re.search(r'-' + name + '=', line, re.IGNORECASE)
    if not match:
        return None
    rest = line[match.end():]
    if match.start() > 0 and line[match.start() - 1] == '"':
        return rest.split('"', 1)[0]
    if rest.startswith('"'):
        return rest[1:].split('"', 1)[0]
    return rest.split()[0] if rest.split() else None


ROOT = os.path.abspath(unreal.Paths.project_dir())
project = os.path.normcase(os.path.abspath(unreal.Paths.get_project_file_path()))
expected = os.path.normcase(os.path.join(ROOT, 'ST01c_Pilot.uproject'))
if project != expected or '/.scratch/' not in ROOT.replace('\\', '/'):
    raise RuntimeError('Source probe requires this isolated scratch project')
SPEC_PATH = command_line_value('SystemSpec')
RUN = command_line_value('ProbeRun')
if not SPEC_PATH or not os.path.isfile(SPEC_PATH):
    raise RuntimeError('Source probe requires -SystemSpec=<absolute spec json>')
if not RUN or not re.fullmatch(r'[A-Za-z0-9_-]{1,40}', RUN):
    raise RuntimeError('Source probe requires a bounded -ProbeRun=<name>')
with open(SPEC_PATH, encoding='utf-8') as spec_file:
    SPEC = json.load(spec_file)
if SPEC.get('schema') != 'st01c-system-spec/v1':
    raise RuntimeError('Unsupported system spec schema')
OUT = os.path.join(ROOT, RUN)
if os.path.exists(OUT):
    raise RuntimeError('Source probe requires a fresh output directory')
os.makedirs(OUT)
SYSTEM = SPEC['systemPackage']
SYSTEM_NAME = SYSTEM.rsplit('/', 1)[1]
PACK = SPEC['packRoot']

report = {'schema': 'st01c-source-probe/v1', 'engine': str(unreal.SystemLibrary.get_engine_version()),
          'project': unreal.Paths.get_project_file_path(), 'systemSpec': SPEC_PATH.replace('\\', '/'), 'exports': [], 'objects': [], 'materials': [], 'errors': [],
          'scope': 'Source data only; does not prove simulation semantics or visual equivalence.'}

def write_report():
    with open(os.path.join(OUT, 'report.json'), 'w', encoding='utf-8', newline='\n') as file:
        json.dump(report, file, ensure_ascii=False, indent=2)
        file.write('\n')

def path_of(obj):
    return str(obj.get_path_name()) if obj is not None else None

def fields(obj, names):
    result = {}
    for name in names:
        try:
            value = obj.get_editor_property(name)
            if value is None or isinstance(value, (str, int, float, bool)):
                result[name] = value
            elif isinstance(value, unreal.Object):
                result[name] = {'objectPath': path_of(value), 'class': value.get_class().get_name()}
            else:
                result[name] = {'representation': str(value), 'interpreted': False}
        except Exception as error:
            result[name] = {'unavailable': str(error)[:300]}
    return result

def export_object(obj, label):
    dest = os.path.join(OUT, label + '.t3d')
    task = unreal.AssetExportTask()
    task.object = obj
    task.filename = dest
    task.exporter = unreal.ObjectExporterT3D()
    task.automated = True
    task.prompt = False
    task.replace_identical = False
    ok = unreal.Exporter.run_asset_export_task(task)
    row = {'objectPath': path_of(obj), 'class': obj.get_class().get_name(), 'ok': bool(ok), 'file': os.path.basename(dest)}
    if os.path.isfile(dest):
        with open(dest, 'rb') as file:
            data = file.read()
        row.update(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
    report['exports'].append(row)

try:
    project = os.path.normcase(os.path.abspath(report['project']))
    expected = os.path.normcase(os.path.join(ROOT, 'ST01c_Pilot.uproject'))
    if project != expected:
        raise RuntimeError('Probe refuses any project outside the isolated copy')
    report['availableExporter'] = hasattr(unreal, 'ObjectExporterT3D')
    system = unreal.load_asset(SYSTEM)
    if system is None or system.get_class().get_name() != 'NiagaraSystem':
        raise RuntimeError('Exact pilot did not load as NiagaraSystem')
    report['systemFields'] = fields(system, ['emitter_handles', 'system_spawn_script', 'system_update_script', 'exposed_parameters'])
    export_object(system, 'system')
    for package in SPEC['emitterAssets']:
        emitter = unreal.load_asset(package)
        if emitter is None:
            raise RuntimeError('Emitter did not load: ' + package)
        export_object(emitter, package.rsplit('/', 1)[1])
    queue = [unreal.load_asset(package) for package in SPEC['materialInstances']]
    visited = set()
    while queue:
        obj = queue.pop(0)
        if obj is None or path_of(obj) in visited:
            continue
        visited.add(path_of(obj))
        cls = obj.get_class().get_name()
        row = {'objectPath': path_of(obj), 'class': cls}
        if cls == 'MaterialInstanceConstant':
            row['fields'] = fields(obj, ['parent', 'texture_parameter_values', 'scalar_parameter_values', 'vector_parameter_values', 'static_parameters'])
            queue.append(obj.get_editor_property('parent'))
        else:
            row['fields'] = fields(obj, ['blend_mode', 'material_domain', 'two_sided', 'shading_model', 'expressions', 'emissive_color', 'opacity'])
        report['materials'].append(row)
        export_object(obj, obj.get_name())
    # Preserve subobject identity; enumeration is not the list of active handles/renderers.
    classes = ['NiagaraEmitter', 'NiagaraSpriteRendererProperties', 'NiagaraScript', 'NiagaraScriptSource', 'NiagaraGraph', 'NiagaraNodeFunctionCall', 'NiagaraDataInterfaceCurve', 'NiagaraDataInterfaceVectorCurve', 'NiagaraDataInterfaceColorCurve']
    for cls_name in classes:
        wrapper = getattr(unreal, cls_name, None)
        if wrapper is None:
            report['errors'].append({'class': cls_name, 'unavailable': 'Python wrapper missing'})
            continue
        count = 0
        for obj in unreal.ObjectIterator(wrapper):
            path = path_of(obj)
            if not path.startswith(SYSTEM + '.' + SYSTEM_NAME + ':') and not path.startswith(PACK + '/FX/NiagaraEmitters/'):
                continue
            count += 1
            if count > 256:
                raise RuntimeError('Bounded object enumeration exceeded 256 for ' + cls_name)
            names = {
                'NiagaraEmitter': ['versioned_emitter_data', 'graph_source', 'renderer_properties'],
                'NiagaraScript': ['usage', 'usage_id', 'source', 'rapid_iteration_parameters'],
                'NiagaraSpriteRendererProperties': ['material', 'sub_image_size', 'alignment', 'facing_mode', 'pivot_in_uv_space', 'sort_mode', 'is_enabled'],
                'NiagaraScriptSource': ['node_graph'],
                'NiagaraGraph': ['nodes'],
                'NiagaraNodeFunctionCall': ['function_script', 'function_name', 'selected_script_version', 'pins'],
                'NiagaraDataInterfaceCurve': ['curve'],
                'NiagaraDataInterfaceVectorCurve': ['x_curve', 'y_curve', 'z_curve'],
                'NiagaraDataInterfaceColorCurve': ['red_curve', 'green_curve', 'blue_curve', 'alpha_curve'],
            }.get(cls_name, [])
            report['objects'].append({'objectPath': path, 'class': obj.get_class().get_name(), 'fields': fields(obj, names)})
    report['completed'] = True
except Exception:
    report['completed'] = False
    report['fatal'] = traceback.format_exc()
finally:
    write_report()
    unreal.log('ST01c bounded source probe wrote ' + OUT)
