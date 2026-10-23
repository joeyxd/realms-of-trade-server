"""Condense first-seen particle states; later frames remain independent validation data."""
import argparse
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
SHA = '985a431dc6c0d1ca1c43a31765754bae7cc78b853ca1fcadc1fa3fd093ec2165'
NAMES = ['NE_Flame_Basic_001', 'NE_Smoke_Basic']


def prepare(run):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,40}', run):
        raise ValueError('Invalid capture run')
    base = ROOT / '.scratch/unreal' / run
    report = json.loads((base / 'capture-report.json').read_text(encoding='utf8'))
    assert report['status'] == 'complete' and report['source_copy_package_sha256'] == SHA
    assert len(report['particle_samples']) == 241
    source = ROOT / '.scratch/unreal/probe01/system.t3d'
    text = source.read_text(encoding='utf8')
    owner = '/Game/sA_Megapack_v1/sA_StylizedAttacksPack/FX/NiagaraSystems/NS_Flame_Single.NS_Flame_Single:NE_Smoke_Basic.NiagaraScriptSource_0.NiagaraGraph_0.NiagaraNodeInput_1.Scale Alpha.FloatCurve'
    blocks = re.findall(r'Begin Object Name="Scale Alpha.FloatCurve" ExportPath="/Script/Niagara.NiagaraDataInterfaceCurve\'' + re.escape(owner) + r'\'"(.*?)End Object', text, re.S)
    assert len(blocks) == 1, 'Exact active curve owner required'
    block = blocks[0]
    lut = re.findall(r'ShaderLUT\((\d+)\)=([-\d.]+)', block)
    assert [int(i) for i, _ in lut] == list(range(54))
    prop = lambda name: float(re.search(r'\b' + name + r'=([-\d.]+)', block)[1])
    curve = {'minTime': prop('LUTMinTime'), 'inverseRange': prop('LUTInvTimeRange'),
             'samples': [float(v) for _, v in lut], 'owner': owner}
    assert prop('LUTNumSamplesMinusOne') == len(lut) - 1
    births, seen, hashes = [], [set(), set()], []
    for step, row in enumerate(report['particle_samples']):
        assert row['step'] == step and row['file'] == f'particles/step_{step:04d}.json'
        raw = (base / row['file']).read_bytes()
        frame = json.loads(raw)
        assert frame['schema'] == 'st01c-cpu-frame/v1'
        assert [e['name'] for e in frame['emitters']] == NAMES
        hashes.append(hashlib.sha256(raw).hexdigest())
        for index, emitter in enumerate(frame['emitters']):
            ids = [p['uniqueId'] for p in emitter['particles']]
            assert len(ids) == len(set(ids))
            for p in emitter['particles']:
                if p['uniqueId'] not in seen[index]:
                    assert p['age'] < 1 / 60 and step > 0
                    births.append({'step': step, 'emitter': index, 'particle': p})
                    seen[index].add(p['uniqueId'])
    payload = {'schema': 'st01c-spawn-fixture/v1', 'sourceSha256': SHA, 'sourceRun': run,
               'sourceStepCount': 240, 'sourceStepSeconds': 1 / 60, 'emitterNames': NAMES,
               'scope': 'First observed state after interpolated spawn; NOT a native spawn generator.',
               'alphaCurve': curve, 'births': births,
               'provenance': {'sourceTextSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                              'captureReportSha256': hashlib.sha256((base / 'capture-report.json').read_bytes()).hexdigest(),
                              'frameSha256': hashes}}
    dest = base / 'update-fixture.json'
    encoded = (json.dumps(payload, ensure_ascii=False, indent=2) + '\n').encode('utf8')
    if dest.exists() and dest.read_bytes() != encoded:
        raise ValueError('Refusing to overwrite a different fixture')
    dest.write_bytes(encoded)
    print(json.dumps({'run': run, 'births': len(births), 'bytes': len(encoded), 'sha256': hashlib.sha256(encoded).hexdigest()}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('run', nargs='?', default='reference11')
    prepare(parser.parse_args().run)
