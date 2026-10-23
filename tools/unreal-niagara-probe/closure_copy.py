"""Copy a system package closure from MyProject into the isolated project, with a SHA audit.

Standard library only. Reads C:/Unreal (never writes there). Typical use:

  python closure_copy.py --spec systems/ns-basichit.json --apply
  (run probe_closure.py in the editor, then repeat with --extra <closure json> until it lists nothing missing)
  python closure_copy.py --spec systems/ns-basichit.json --extra <closure json> --apply --audit <out json>

Seeds come from the st01b dependency report (system, direct /Game dependencies, texture
packages); --extra adds the AssetRegistry closure that probe_closure.py reads. A file that
already exists in the destination must hash equal to the original, or the run stops (exit 3).
Files listed in --baseline (the pilot copy audit) are reported as already-present.
"""
import argparse
import hashlib
import json
import os
import shutil
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
DEFAULT_SRC = 'C:/Unreal/MyProject/Content'
DEFAULT_DEST = os.path.join(REPO, '.scratch', 'unreal', 'Content')
DEFAULT_DEPS = os.path.join(REPO, 'docs', 'research', 'unreal-assets', 'st01b', 'myproject-dependencies.json')
DEFAULT_BASELINE = os.path.join(REPO, 'docs', 'delivery', 'st01c', 'source-copy-audit.json')


def sha256_of(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as file:
        for block in iter(lambda: file.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def relative_of(package):
    assert package.startswith('/Game/'), package
    return package[len('/Game/'):] + '.uasset'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--spec', required=True)
    parser.add_argument('--deps', default=DEFAULT_DEPS)
    parser.add_argument('--src', default=DEFAULT_SRC)
    parser.add_argument('--dest', default=DEFAULT_DEST)
    parser.add_argument('--baseline', default=DEFAULT_BASELINE)
    parser.add_argument('--extra', action='append', default=[], help='closure json written by probe_closure.py')
    parser.add_argument('--apply', action='store_true', help='copy missing files (default: dry run)')
    parser.add_argument('--audit', help='write the audit json here')
    args = parser.parse_args()

    with open(args.spec, encoding='utf-8') as file:
        spec = json.load(file)
    with open(args.deps, encoding='utf-8') as file:
        deps = json.load(file)
    entry = [row for row in deps['systems'] if row['system'] == spec['systemPackage']]
    if len(entry) != 1:
        print('STOP: system not found exactly once in the dependency report', file=sys.stderr)
        return 2
    entry = entry[0]
    packages = {entry['system']}
    packages.update(p for p in entry['directDependencyPackages'] if p.startswith('/Game/'))
    packages.update(entry['texturePackages'])
    packages.update(entry['materialInstancePackages'])
    seed_count = len(packages)
    non_game = set()
    for extra in args.extra:
        with open(extra, encoding='utf-8') as file:
            closure = json.load(file)
        packages.update(closure['closure'])
        non_game.update(closure['nonGameHardReferences'])
    with open(args.baseline, encoding='utf-8') as file:
        baseline = {row['relative']: row['sha256'] for row in json.load(file)['files']}

    rows, copied, present, failures = [], 0, 0, []
    for package in sorted(packages):
        relative = relative_of(package)
        source = os.path.join(args.src, relative)
        target = os.path.join(args.dest, relative)
        if not os.path.isfile(source):
            failures.append('original missing: ' + source)
            continue
        source_sha = sha256_of(source)
        row = {'relative': relative, 'package': package, 'source': source.replace('/', '\\'),
               'bytes': os.path.getsize(source), 'sha256': source_sha}
        if os.path.isfile(target):
            if sha256_of(target) != source_sha:
                print('STOP: existing copy differs from the original: ' + target, file=sys.stderr)
                return 3
            row['status'] = 'already-present' if baseline.get(relative) == source_sha else 'copied'
        elif args.apply:
            os.makedirs(os.path.dirname(target), exist_ok=True)
            shutil.copyfile(source, target)
            if sha256_of(target) != source_sha:
                print('STOP: copy hash mismatch: ' + target, file=sys.stderr)
                return 3
            row['status'] = 'copied'
        else:
            row['status'] = 'would-copy'
        if row['status'] == 'already-present':
            present += 1
        else:
            copied += 1
        rows.append(row)
    if failures:
        print('\n'.join(failures), file=sys.stderr)
        return 2
    print(f'seeds {seed_count}, closure {len(rows)}, already-present {present}, copied or to copy {copied}')
    if args.audit:
        if any(row['status'] == 'would-copy' for row in rows):
            print('STOP: audit requires --apply', file=sys.stderr)
            return 2
        audit = {
            'schema': 'st01c-source-copy-audit/v1',
            'system': spec['systemPackage'],
            'originalRoot': args.src.replace('/', '\\'),
            'copyRoot': os.path.relpath(args.dest, REPO).replace('\\', '/'),
            'closureMethod': 'dependency report seeds plus AssetRegistry hard-reference closure (probe_closure.py)',
            'engineAndScriptPackageCount': len(non_game),
            'totalHardReferencePackages': len(rows) + len(non_game),
            'files': rows,
            'alreadyPresentCount': present,
            'copiedCount': copied,
        }
        with open(args.audit, 'x', encoding='utf-8', newline='\n') as file:
            json.dump(audit, file, ensure_ascii=False, indent=2)
            file.write('\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
