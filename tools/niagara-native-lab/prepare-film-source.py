"""Extract reviewed UE5.8 constants. No capture pixels or particle states are read."""
import hashlib
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[2]
engine = Path('C:/Program Files/Epic Games/UE_5.8/Engine')
APPROVED = {
    'Shaders/Private/ACES/ACESCommon.ush': '74bc182d346ed6b06a39989a0a694b9fb55eb6c1d2900da5c74dd3edd61ba8ac',
    'Shaders/Private/TonemapCommon.ush': '6014ec0a4c5c38ea24869c408ef14a195200d277612f956d17c60312e82e930e',
    'Shaders/Private/PostProcessCombineLUTs.usf': '3a18c19033b7e924fe81283df6775ad5d92fe98cc662071b20dd6a7ddece40ed',
    'Shaders/Private/PostProcessTonemap.usf': '9f5510d84f222ba20c813d5b8638478d6ee1da73a10bd25a81e35631280e5365',
    'Shaders/Private/GammaCorrectionCommon.ush': 'ea65801253c3950508f754886facfdec3ca03d701ee6d63c27da453ba0572954',
    'Source/Runtime/Engine/Private/Scene.cpp': '2223ff5f59c5bfed3d718d76fba7470560841edead2e03349acaddb6268d9dde',
    'Source/Runtime/Engine/Private/TextureRenderTarget2D.cpp': '211e007db31de48039e65e3cf59fac23dbc4a943d3f63601d05469464a15e227',
    'Source/Runtime/Renderer/Private/PostProcess/PostProcessCombineLUTs.cpp': '6a8b3e34a47246fb648e02c5b334130076489cd7bc05339ff44a2e048a52566a',
    'Source/Runtime/Renderer/Private/PostProcess/PostProcessTonemap.cpp': '1f8aac9618e4cd4e328ac7d7601ea6f5e29ad14813cf4b3a64f72ecebb2b52e4',
    'Shaders/Private/ACES/ACES_v1.3.ush': 'c2be7dba2fde2242576adae8e2ad140cdc0242132006286a3e567c89f214fbc8',
    'Build/Build.version': '2dbc75e44f11207d10b94639b222bbcecd2eb2e45eb0a901d0cca1005d36125e'}
files = list(APPROVED)
for p in files:
    assert hashlib.sha256((engine/p).read_bytes()).hexdigest() == APPROVED[p], 'Unreviewed engine source: '+p
texts = {p: (engine/p).read_text(encoding='utf8') for p in files}
def matrix(text, name):
    m = re.search(r'\b'+name+r'\s*=\s*(?://[^\n]*\n)?\s*\{(.*?)\}', text, re.S)
    if not m:
        raise ValueError('Missing matrix '+name)
    body = re.sub(r'//[^\n]*', '', m[1])
    values = [float(v) for v in re.findall(r'[-+]?(?:\d+\.\d*|\d*\.\d+|\d+)(?:[Ee][-+]?\d+)?', body)]
    assert len(values) == 9
    return [values[i:i+3] for i in range(0, 9, 3)]
common = texts[files[0]]
combine = texts[files[2]]
matrices = {n: matrix(common, n) for n in ['AP0_2_XYZ_MAT', 'XYZ_2_AP0_MAT', 'AP1_2_XYZ_MAT',
    'XYZ_2_AP1_MAT', 'AP0_2_AP1_MAT', 'AP1_2_AP0_MAT', 'XYZ_2_sRGB_MAT', 'sRGB_2_XYZ_MAT',
    'D65_2_D60_CAT', 'D60_2_D65_CAT']}
for n in ['BlueCorrect', 'BlueCorrectInv', 'Wide_2_XYZ_MAT']:
    matrices[n] = matrix(combine, n)
controls = {}
for name in ['FilmSlope', 'FilmToe', 'FilmShoulder', 'FilmBlackClip', 'FilmWhiteClip', 'BlueCorrection', 'ExpandGamut', 'ToneCurveAmount']:
    m = re.search(r'\b'+name+r'\s*=\s*([\d.]+)f?;', texts[files[5]])
    assert m
    controls[name] = float(m[1])
backend_path = root/'.scratch/unreal/color05/color-platform.json'
backend_bytes = backend_path.read_bytes()
assert hashlib.sha256(backend_bytes).hexdigest() == 'e97557f5de5863fe6f26d5dbad25d4e5d361f1a1c23a93f35945e891d54d47cd', 'Unreviewed backend metadata'
backend = json.loads(backend_bytes)
assert backend['sdrLutQuantizationBits'] == 10 and backend['resourceDisplayOutputFormat'] == 0 and backend['resourceDisplayColorGamut'] == 0
assert abs(backend['displayGamma']-2.2) < 1e-6 and not backend['resourceSceneHDREnabled']
spec = {'size': 32, 'max': 1.05, 'channelQuantizationBits': backend['sdrLutQuantizationBits'], 'shaper': 'Log2',
    'linearRange': 14, 'linearGrey': .18, 'exposureGrey': 444, 'codeValueMax': 1023,
    'targetDisplayGamma': 2.2, 'sdrEncoding': 'sRGB', 'inverseGammaY': 1}
data = {'schema': 'st01c-film-source/v1', 'engine': '5.8.0-55116800+++UE5+Release-5.8',
    'profile': 'Filmic SDR sRGB; neutral grading; no bloom; 6500K/0 tint; explicit target gamma2.2',
    'sourceSha256': {p: hashlib.sha256((engine/p).read_bytes()).hexdigest() for p in files},
    'matrices': matrices, 'controls': controls, 'lut': spec, 'captureInputs': False,
    'backendMetadata': {'file': '.scratch/unreal/color05/color-platform.json',
        'sha256': hashlib.sha256(backend_bytes).hexdigest(), 'containsPixelsOrParticles': False},
    'profilePolicy': '32-cube Log2 explicitly configured; source LUTMax1.05; neutral grading; SDR sRGB gamma2.2; preferred10bit supported by measured RHI capability'}
def canonical(value):
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, list):
        return [canonical(v) for v in value]
    if isinstance(value, dict):
        return {k: canonical(v) for k, v in value.items()}
    return value
data = canonical(data)
matrices, controls, spec = data['matrices'], data['controls'], data['lut']
path = root/'tools/niagara-native-lab/film-source.json'
path.write_bytes((json.dumps(data, indent=2)+'\n').encode('utf8'))
digest = hashlib.sha256(path.read_bytes()).hexdigest()
behavior = json.dumps([matrices, controls, spec], separators=(',', ':'))
identity = '// Exact source constants and supported private color profile.\n'
identity += 'export const FILM_SOURCE_SHA256 = '+json.dumps(digest)+';\n'
identity += 'export const FILM_BEHAVIOR = '+behavior+';\n'
(root/'tools/niagara-native-lab/film-identity.js').write_bytes(identity.encode('utf8'))
print(json.dumps({'bytes': path.stat().st_size, 'sha256': digest, 'matrices': len(matrices)}))
