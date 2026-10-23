"""Hard-reference package closure of a spec's system, read from the editor AssetRegistry.

Command line: -SystemSpec=<absolute systems/*.json> -ProbeRun=<fresh name>.
Writes the fresh file <project>/<ProbeRun>.json. Reads package headers only: it never
loads an asset and never writes under Content. Packages the closure names that are not
in the project Content yet are listed under "missing" so the copy step can fetch them.
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
    raise RuntimeError('Closure probe requires -SystemSpec=<absolute spec json>')
if not run or not re.fullmatch(r'[A-Za-z0-9_-]{1,40}', run):
    raise RuntimeError('Closure probe requires a bounded -ProbeRun=<name>')
with open(spec_path, encoding='utf-8') as spec_file:
    spec = json.load(spec_file)
if spec.get('schema') != 'st01c-system-spec/v1':
    raise RuntimeError('Unsupported system spec schema')
output = os.path.join(root, run + '.json')
if os.path.exists(output):
    raise RuntimeError('Closure probe requires a fresh output file')

registry = unreal.AssetRegistryHelpers.get_asset_registry()
registry.scan_paths_synchronous(['/Game'], True)


def options(hard):
    return unreal.AssetRegistryDependencyOptions(
        include_soft_package_references=not hard, include_hard_package_references=hard,
        include_searchable_names=False, include_soft_management_references=False,
        include_hard_management_references=False)


def dependencies(package, hard):
    return [str(name) for name in (registry.get_dependencies(unreal.Name(package), options(hard)) or [])]


def on_disk(package):
    return os.path.isfile(os.path.join(root, 'Content', package[len('/Game/'):] + '.uasset'))


closure, queue, other = set(), [spec['systemPackage']], set()
while queue:
    package = queue.pop()
    if package in closure:
        continue
    closure.add(package)
    if not on_disk(package):
        continue
    for dep in dependencies(package, True):
        if dep.startswith('/Game/'):
            queue.append(dep)
        else:
            other.add(dep)
soft_only = set()
for package in closure:
    if on_disk(package):
        soft_only.update(dep for dep in dependencies(package, False) if dep.startswith('/Game/') and dep not in closure)
report = {'schema': 'st01c-closure/v1', 'system': spec['systemPackage'], 'scope': 'hard package references via AssetRegistry',
          'closure': sorted(closure), 'missing': sorted(p for p in closure if not on_disk(p)),
          'nonGameHardReferences': sorted(other), 'softOnlyGamePackages': sorted(soft_only)}
with open(output, 'x', encoding='utf-8', newline='\n') as file:
    json.dump(report, file, ensure_ascii=False, indent=2)
    file.write('\n')
