"""Export engine assets to T3D and read texture sampler fields, read only.

Command line: -AssetQuery=<absolute path of a st01c-asset-query/v1 json> -ProbeRun=<fresh name>.
Writes the fresh folder <project>/<ProbeRun>/ with one <AssetName>.t3d per exportT3D entry and
textures.json (requested fields as str() values plus the source size). Nothing is saved.
"""
import json
import os
import re
import unreal

SCHEMA = 'st01c-asset-query/v1'
KEYS = ('schema', 'exportT3D', 'textures', 'textureFields')


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


def string_list(query, key):
    value = query[key]
    if not isinstance(value, list) or not value or any(not isinstance(item, str) or not item for item in value):
        raise RuntimeError('Query key %s must be a non-empty list of strings' % key)
    if len(set(value)) != len(value):
        raise RuntimeError('Query key %s has duplicates' % key)
    return value


def asset_name(path):
    return re.split(r'[./]', path.rstrip('/'))[-1]


root = os.path.abspath(unreal.Paths.project_dir())
if os.path.normcase(os.path.abspath(unreal.Paths.get_project_file_path())) != os.path.normcase(os.path.join(root, 'ST01c_Pilot.uproject')) or '/.scratch/' not in root.replace(os.sep, '/'):
    raise RuntimeError('Wrong isolated project')
query_path = command_line_value('AssetQuery')
run = command_line_value('ProbeRun')
if not query_path or not os.path.isabs(query_path) or not os.path.isfile(query_path):
    raise RuntimeError('Engine asset probe requires -AssetQuery=<absolute query json>')
if not run or not re.fullmatch(r'[A-Za-z0-9_-]{1,40}', run):
    raise RuntimeError('Engine asset probe requires a bounded -ProbeRun=<name>')
with open(query_path, encoding='utf-8') as query_file:
    query = json.load(query_file)
if not isinstance(query, dict) or set(query) != set(KEYS):
    raise RuntimeError('Query keys must be exactly %s, got %s' % (sorted(KEYS), sorted(query) if isinstance(query, dict) else type(query).__name__))
if query['schema'] != SCHEMA:
    raise RuntimeError('Unsupported query schema')
export_paths = string_list(query, 'exportT3D')
texture_paths = string_list(query, 'textures')
fields = string_list(query, 'textureFields')
names = [asset_name(path) for path in export_paths]
if len(set(names)) != len(names):
    raise RuntimeError('exportT3D asset names collide')
out_dir = os.path.join(root, run)
if os.path.exists(out_dir):
    raise RuntimeError('Engine asset probe requires a fresh output folder, %s already exists' % run)

# Load everything first: a failed load must not leave a half-written run folder.
export_assets = []
for path in export_paths:
    obj = unreal.load_asset(path)
    if obj is None:
        raise RuntimeError('Asset did not load: ' + path)
    export_assets.append(obj)
textures = []
for path in texture_paths:
    obj = unreal.load_asset(path)
    if obj is None:
        raise RuntimeError('Texture did not load: ' + path)
    textures.append(obj)


def texture_row(texture):
    row = {'path': texture.get_path_name(), 'class': texture.get_class().get_name(), 'fields': {}}
    for field in fields:
        # No try/except: an unreadable requested field must fail the run.
        row['fields'][field] = str(texture.get_editor_property(field))
    row['sourceSize'] = {'x': int(texture.blueprint_get_size_x()), 'y': int(texture.blueprint_get_size_y())}
    return row


report = {'schema': 'st01c-asset-textures/v1', 'textures': [texture_row(texture) for texture in textures]}

os.makedirs(out_dir)
for obj, name in zip(export_assets, names):
    dest = os.path.join(out_dir, name + '.t3d')
    task = unreal.AssetExportTask()
    task.object = obj
    task.filename = dest
    task.automated = True
    task.prompt = False
    task.replace_identical = False
    # task.exporter stays unset: Unreal picks the exporter from the class and the .t3d extension.
    ok = unreal.Exporter.run_asset_export_task(task)
    exporter = task.exporter.get_class().get_name() if task.exporter else 'none'
    unreal.log_warning('ENGINE_ASSET_EXPORT %s ok=%s exporter=%s' % (obj.get_path_name(), ok, exporter))
    if not ok or not os.path.isfile(dest) or os.path.getsize(dest) == 0:
        raise RuntimeError('T3D export failed: ' + obj.get_path_name())
with open(os.path.join(out_dir, 'textures.json'), 'x', encoding='utf-8', newline='\n') as file:
    json.dump(report, file, ensure_ascii=False, indent=2)
    file.write('\n')
