"""Read effective source defaults omitted by Unreal's text exporter.

Command line: -SystemSpec=<absolute systems/*.json> -ProbeRun=<fresh name>.
Writes the fresh file <project>/<ProbeRun>.json.
"""
import json
import os
import re
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


root = os.path.abspath(unreal.Paths.project_dir())
if os.path.normcase(os.path.abspath(unreal.Paths.get_project_file_path())) != os.path.normcase(os.path.join(root, 'ST01c_Pilot.uproject')) or '/.scratch/' not in root.replace('\\', '/'):
    raise RuntimeError('Wrong isolated project')
spec_path = command_line_value('SystemSpec')
run = command_line_value('ProbeRun')
if not spec_path or not os.path.isfile(spec_path):
    raise RuntimeError('Material probe requires -SystemSpec=<absolute spec json>')
if not run or not re.fullmatch(r'[A-Za-z0-9_-]{1,40}', run):
    raise RuntimeError('Material probe requires a bounded -ProbeRun=<name>')
with open(spec_path, encoding='utf-8') as spec_file:
    spec = json.load(spec_file)
if spec.get('schema') != 'st01c-system-spec/v1':
    raise RuntimeError('Unsupported system spec schema')
output = os.path.join(root, run + '.json')
if os.path.exists(output):
    raise RuntimeError('Material probe requires a fresh output file')


materials = [unreal.load_asset(package) for package in spec['baseMaterials']]
if any(material is None for material in materials):
    raise RuntimeError('A base material did not load')
prefixes = tuple(material.get_path_name() + ':' for material in materials)
classes = spec['expressionClasses']
report = {'schema': 'st01c-material-defaults/v1', 'expressions': [], 'instances': []}
recorded = set()
for name, fields in classes.items():
    for obj in unreal.ObjectIterator(getattr(unreal, name)):
        # Iterating a base class also yields its subclasses: keep the first (most specific listed) record.
        if not obj.get_path_name().startswith(prefixes) or obj.get_path_name() in recorded:
            continue
        recorded.add(obj.get_path_name())
        row = {'path': obj.get_path_name(), 'class': obj.get_class().get_name(), 'fields': {}}
        for field in fields:
            try:
                value = obj.get_editor_property(field)
                row['fields'][field] = value if isinstance(value, (str, int, float, bool)) else value.get_path_name() if isinstance(value, unreal.Object) else str(value)
            except Exception as error:
                row['fields'][field] = {'unavailable': str(error)[:220]}
        report['expressions'].append(row)
for package in spec['materialInstances']:
    obj = unreal.load_asset(package)
    row = {'path': obj.get_path_name(), 'scalars': [], 'textures': []}
    for field, out in [('scalar_parameter_values', 'scalars'), ('texture_parameter_values', 'textures')]:
        for param in obj.get_editor_property(field):
            info = param.get_editor_property('parameter_info')
            value = param.get_editor_property('parameter_value')
            row[out].append({'name': str(info.get_editor_property('name')), 'value': value if isinstance(value, (str, int, float, bool)) else value.get_path_name() if value else None})
    report['instances'].append(row)
with open(output, 'x', encoding='utf-8', newline='\n') as file:
    json.dump(report, file, ensure_ascii=False, indent=2)
    file.write('\n')
