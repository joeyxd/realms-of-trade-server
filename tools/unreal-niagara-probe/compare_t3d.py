"""Compare two source-probe run folders with run-local change GUIDs masked.

Unreal assigns fresh random ChangeId values (CachedChangeId, ChangeId,
LastBuiltTraversalDataChangeId) while it loads a Niagara system, so two exports of
the same asset are never byte-identical. This tool masks only those 32-hex values
and then compares every .t3d of the two folders byte for byte.

Usage: python compare_t3d.py <run folder A> <run folder B>
Exit 0 when every file matches after masking, 1 otherwise. Standard library only.
"""
import hashlib
import os
import re
import sys

GUID = re.compile(rb'(\w*ChangeId)=[0-9A-F]{32}')


def masked(path):
    with open(path, 'rb') as file:
        data = file.read()
    return GUID.sub(rb'\1=<masked>', data), len(GUID.findall(data))


def main():
    if len(sys.argv) != 3:
        print('usage: compare_t3d.py <run A> <run B>', file=sys.stderr)
        return 2
    a, b = sys.argv[1], sys.argv[2]
    names_a = sorted(n for n in os.listdir(a) if n.endswith('.t3d'))
    names_b = sorted(n for n in os.listdir(b) if n.endswith('.t3d'))
    if names_a != names_b:
        print('different file sets', names_a, names_b)
        return 1
    failed = 0
    for name in names_a:
        data_a, count_a = masked(os.path.join(a, name))
        data_b, count_b = masked(os.path.join(b, name))
        same = data_a == data_b
        failed += 0 if same else 1
        print(f'{"same" if same else "DIFF"} {name} masked={count_a}/{count_b} sha256(masked)={hashlib.sha256(data_a).hexdigest()[:16]}/{hashlib.sha256(data_b).hexdigest()[:16]}')
    print('OK' if not failed else f'FAIL {failed} files differ')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
