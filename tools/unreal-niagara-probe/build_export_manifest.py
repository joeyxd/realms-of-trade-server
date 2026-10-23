"""Write a source-export manifest that pins one extraction (source, compiled, native values, material defaults).

Usage:
  python build_export_manifest.py --spec systems/ns-basichit.json --unreal-dir .scratch/unreal \
      --source-run basichit-source --compiled-run basichit-compiled \
      --native-values-run basichit-native-values --material-defaults-run basichit-material-defaults2 \
      --closure-run basichit-closure01 --output docs/delivery/st01c/basichit/source-export-manifest.json

The T3D and HLSL files stay in the git-ignored run folders; the manifest pins them by hash.
Run names refer to folders or files directly under --unreal-dir. Standard library only.
"""
import argparse
import hashlib
import json
import os
import sys


def sha256_of(path):
    with open(path, 'rb') as file:
        return hashlib.sha256(file.read()).hexdigest()


def load(path):
    with open(path, encoding='utf-8') as file:
        return json.load(file)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--spec', required=True)
    parser.add_argument('--unreal-dir', required=True)
    parser.add_argument('--source-run', required=True)
    parser.add_argument('--compiled-run', required=True)
    parser.add_argument('--native-values-run', required=True)
    parser.add_argument('--material-defaults-run', required=True)
    parser.add_argument('--closure-run', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()

    base = args.unreal_dir
    spec = load(args.spec)
    source = load(os.path.join(base, args.source_run, 'report.json'))
    compiled_path = os.path.join(base, args.compiled_run, 'report.json')
    compiled = load(compiled_path)
    native_path = os.path.join(base, args.native_values_run + '.json')
    material_path = os.path.join(base, args.material_defaults_run + '.json')
    closure_path = os.path.join(base, args.closure_run + '.json')
    native = load(native_path)

    if not source.get('completed'):
        print('STOP: source probe did not complete', file=sys.stderr)
        return 2
    if spec['expectedScriptCount'] is not None and len(compiled['scripts']) != spec['expectedScriptCount']:
        print('STOP: compiled script count differs from the spec', file=sys.stderr)
        return 2
    scripts = []
    for index, script in enumerate(compiled['scripts']):
        file_path = os.path.join(base, args.compiled_run, script['file'])
        if sha256_of(file_path) != script['sha256']:
            print('STOP: HLSL hash differs from the compiled report: ' + script['file'], file=sys.stderr)
            return 2
        scripts.append({'order': index, 'usage': script['usage'], 'path': script['path'], 'compileStatus': script['compileStatus'],
                        'file': script['file'], 'bytes': script['bytes'], 'sha256': script['sha256']})
    for row in source['exports']:
        if sha256_of(os.path.join(base, args.source_run, row['file'])) != row['sha256']:
            print('STOP: T3D hash differs from the source report: ' + row['file'], file=sys.stderr)
            return 2

    manifest = {
        'schema': 'st01c-source-export-manifest/v1',
        'system': spec['systemPackage'],
        'systemSpec': {'file': 'tools/unreal-niagara-probe/systems/' + os.path.basename(args.spec), 'sha256': sha256_of(args.spec)},
        'engine': source['engine'],
        'completed': True,
        'runs': {
            'source': args.source_run,
            'compiled': args.compiled_run,
            'nativeValues': args.native_values_run + '.json',
            'materialDefaults': args.material_defaults_run + '.json',
            'closure': args.closure_run + '.json',
            'location': '.scratch/unreal (git-ignored); T3D and HLSL stay there and are pinned by hash',
        },
        'exports': source['exports'],
        'unsupportedPythonWrappers': source['errors'],
        'compiled': {
            'reportSha256': sha256_of(compiled_path),
            'scriptCount': len(scripts),
            'settings': {key: value for key, value in compiled['settings'].items() if key != 'sourceEnums'},
            'vmReciprocalEstimates': compiled['vmReciprocalEstimates'],
            'scripts': scripts,
        },
        'nativeValues': {'sha256': sha256_of(native_path), 'emitterHandleCount': native['emitterHandleCount'],
                         'handleNames': [emitter['handleName'] for emitter in native['emitters']]},
        'materialDefaults': {'sha256': sha256_of(material_path)},
        'closure': {'sha256': sha256_of(closure_path)},
        'scope': 'Source data only; does not prove simulation semantics or visual equivalence.',
    }
    with open(args.output, 'x', encoding='utf-8', newline='\n') as file:
        json.dump(manifest, file, ensure_ascii=False, indent=2)
        file.write('\n')
    print(f'manifest written: {len(manifest["exports"])} exports, {len(scripts)} scripts')
    return 0


if __name__ == '__main__':
    sys.exit(main())
