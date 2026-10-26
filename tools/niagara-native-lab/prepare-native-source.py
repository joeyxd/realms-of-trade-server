"""Build a bounded source preset from compiler output, never from captured particles."""
import argparse
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
SHA = '985a431dc6c0d1ca1c43a31765754bae7cc78b853ca1fcadc1fa3fd093ec2165'
COMPILED_REPORT_SHA = '842837800b88ab940f644ffa1323dd1d2aecd3db3073bd88c05368a9ab527a58'
SOURCE_TEXT_SHA = 'd7d78b14338a081a2b2a0af6a86ded8faf4fe46072e2e0fc26e1b0fc90d7aa11'


def prepare(run):
    assert re.fullmatch(r'[A-Za-z0-9_-]{1,40}', run)
    base = ROOT / '.scratch/unreal' / run
    report_bytes = (base / 'report.json').read_bytes()
    assert hashlib.sha256(report_bytes).hexdigest() == COMPILED_REPORT_SHA, 'Unreviewed compiler output'
    report = json.loads(report_bytes)
    assert report['schema'] == 'st01c-compiled-pilot/v1' and len(report['scripts']) == 10
    texts = {}
    for row in report['scripts']:
        raw = (base / row['file']).read_bytes()
        assert hashlib.sha256(raw).hexdigest() == row['sha256']
        texts[row['file']] = raw.decode('utf8')
    flame = texts['02-ParticleSpawnScriptInterpolated.hlsl']
    smoke = texts['06-ParticleSpawnScriptInterpolated.hlsl']
    system = texts['01-SystemUpdateScript.hlsl']
    body = lambda text, name: re.findall(r'void ' + name + r'\([^;]+?\)\n\{(.*?)\n\}', text, re.S)[0]
    scalar = lambda text, key: float(re.findall(r'float ' + key + r' = ([-\d.e]+);', text)[0])
    vector = lambda text, key: [float(x) for x in re.findall(r'float[34] ' + key + r' = float[34]\(([^)]+)\);', text)[0].split(',')]
    fsize = body(flame, 'UniformRangedFloat_Emitter_Func')
    ssize = body(smoke, 'UniformRangedFloat_Emitter_Func')
    fsphere = body(flame, 'SphereLocation_Emitter_Func')
    scylinder = body(smoke, 'CylinderLocation_Emitter_Func')
    assert 'float Constant99 = 0;' in fsphere and 'float Constant100 = 1;' in fsphere
    for fragment in ['Context.MapSpawn.SphereLocation.HemisphereZ = Constant82;', 'bool Constant82 = true;',
                     'bool Constant92 = false;', 'bool Constant93 = false;']:
        assert fragment in flame
    for fragment in ['Context.MapSpawn.CylinderLocation.EnableLatheProfile = Constant79;',
                     'bool Constant79 = false;', 'bool Constant68 = false;', 'int Constant81 = 2;',
                     'bool Constant77 = false;', 'bool Constant78 = false;']:
        assert fragment in smoke
    source = ROOT / '.scratch/unreal/probe01/system.t3d'
    assert hashlib.sha256(source.read_bytes()).hexdigest() == SOURCE_TEXT_SHA, 'Unreviewed source graph'
    text = source.read_text(encoding='utf8')
    owner = '/Game/sA_Megapack_v1/sA_StylizedAttacksPack/FX/NiagaraSystems/NS_Flame_Single.NS_Flame_Single:NE_Smoke_Basic.NiagaraScriptSource_0.NiagaraGraph_0.NiagaraNodeInput_1.Scale Alpha.FloatCurve'
    blocks = re.findall(r'Begin Object Name="Scale Alpha.FloatCurve" ExportPath="/Script/Niagara.NiagaraDataInterfaceCurve\'' + re.escape(owner) + r'\'"(.*?)End Object', text, re.S)
    assert len(blocks) == 1
    lut = re.findall(r'ShaderLUT\((\d+)\)=([-\d.]+)', blocks[0])
    assert [int(i) for i, _ in lut] == list(range(54))
    prop = lambda name: float(re.search(r'\b' + name + r'=([-\d.]+)', blocks[0])[1])
    result = {'schema': 'st01c-native-source/v1', 'sourceSha256': SHA,
              'emitterNames': ['NE_Flame_Basic_001', 'NE_Smoke_Basic'],
              'fixtureSeeds': [e['fixtureSeed'] for e in report['settings']['emitters']],
              'activationDeltaSeconds': .0001,
              'rates': [scalar(body(system, 'SpawnRate_NE_Flame_Basic_001_Func'), 'Constant138'),
                        scalar(body(system, 'SpawnRate_NE_Smoke_Basic_Func'), 'Constant75')],
              'vmReciprocalEstimates': [r['estimate'] for r in report['vmReciprocalEstimates']],
              'flame': {'size': [scalar(fsize, 'Constant23'), scalar(fsize, 'Constant24')],
                        'color': vector(body(flame, 'MultiplyLinearColor_Emitter_Func'), 'Constant61'),
                        'colorRandomMin': [.7, .7, .7, 1], 'colorRandomMax': [1, 1, 1, 1],
                        'radiusCm': scalar(fsphere, 'Constant116'), 'offsetCm': vector(fsphere, 'Constant118'),
                        'lifetime': 1, 'radialPower': .333333, 'hemispheres': [False, False, True]},
              'smoke': {'size': [scalar(ssize, 'Constant23'), scalar(ssize, 'Constant24')],
                        'color': vector(smoke, 'Constant57'), 'lifetime': scalar(smoke, 'Constant56'),
                        'radiusCm': scalar(scylinder, 'Constant109'), 'heightCm': scalar(scylinder, 'Constant108'),
                        'offsetCm': vector(scylinder, 'Constant126'), 'velocityCm': vector(smoke, 'Constant150'),
                        'surfaceOnly': False, 'enableLatheProfile': False, 'orientationAxis': 2},
              'alphaCurve': {'minTime': prop('LUTMinTime'), 'inverseRange': prop('LUTInvTimeRange'),
                             'samples': [float(v) for _, v in lut], 'owner': owner},
              'provenance': {'compiledRun': run, 'compiledReportSha256': hashlib.sha256((base / 'report.json').read_bytes()).hexdigest(),
                             'scripts': report['scripts'], 'sourceTextSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                             'numericScope': 'UE5.8 Win64 VectorVM reciprocal estimates for fixed rates 3/10; original seed mode nondeterministic; fixture seeds only.'}}
    assert result['rates'] == [3, 10] and result['fixtureSeeds'] == [6371, 6372]
    dest = ROOT / 'src/render/vfx/niagara/pilot-source.json'
    dest.write_bytes((json.dumps(result, ensure_ascii=False, indent=2) + '\n').encode('utf8'))
    print(json.dumps({'bytes': dest.stat().st_size, 'sha256': hashlib.sha256(dest.read_bytes()).hexdigest(), 'particleStatesRead': 0}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('run')
    prepare(parser.parse_args().run)
