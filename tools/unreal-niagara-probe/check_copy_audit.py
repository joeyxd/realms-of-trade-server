"""Re-hash the originals and the copies named by a source-copy audit; exit 1 on any mismatch.

Usage: python check_copy_audit.py <audit.json>
Standard library only. originalRoot is absolute, copyRoot is relative to the repo root.
"""
import hashlib
import json
import os
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))


def sha256_of(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as file:
        for block in iter(lambda: file.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def main():
    if len(sys.argv) != 2:
        print('usage: check_copy_audit.py <audit.json>', file=sys.stderr)
        return 2
    with open(sys.argv[1], encoding='utf-8') as file:
        audit = json.load(file)
    original_root = audit['originalRoot']
    copy_root = os.path.join(REPO, audit['copyRoot'])
    problems = []
    for row in audit['files']:
        for label, root in (('original', original_root), ('copy', copy_root)):
            path = os.path.join(root, row['relative'])
            if not os.path.isfile(path):
                problems.append(f'{label} missing: {path}')
            elif os.path.getsize(path) != row['bytes']:
                problems.append(f'{label} size differs: {path}')
            elif sha256_of(path) != row['sha256']:
                problems.append(f'{label} sha256 differs: {path}')
    if problems:
        print('\n'.join(problems))
        print(f'FAIL {len(problems)} problems in {len(audit["files"])} files')
        return 1
    print(f'{len(audit["files"])} files, {2 * len(audit["files"])} hashes checked: OK')
    return 0


if __name__ == '__main__':
    sys.exit(main())
