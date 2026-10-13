"""Read effective source defaults omitted by Unreal's text exporter."""
import json
import os
import unreal

root = os.path.dirname(os.path.abspath(__file__))
output = os.path.join(root, 'material-defaults.json')
if os.path.exists(output):
    raise RuntimeError('Material probe requires a fresh output file')
if os.path.normcase(os.path.abspath(unreal.Paths.get_project_file_path())) != os.path.normcase(os.path.join(root, 'ST01c_Pilot.uproject')) or '/.scratch/' not in root.replace('\\', '/'):
    raise RuntimeError('Wrong isolated project')
material = unreal.load_asset('/Game/sA_Megapack_v1/sA_StylizedAttacksPack/Materials/M_Smoke')
classes = {
    'MaterialExpressionDepthFade': ['fade_distance_default', 'in_opacity', 'fade_distance'],
    'MaterialExpressionClamp': ['min_default', 'max_default', 'clamp_mode', 'input', 'min', 'max'],
    'MaterialExpressionTextureSampleParameterSubUV': ['texture', 'sampler_type', 'sampler_source', 'blend', 'parameter_name'],
    'MaterialExpressionMultiply': ['const_a', 'const_b', 'a', 'b'],
}
report = {'schema': 'st01c-material-defaults/v1', 'expressions': [], 'instances': []}
for name, fields in classes.items():
    for obj in unreal.ObjectIterator(getattr(unreal, name)):
        if not obj.get_path_name().startswith(material.get_path_name() + ':'):
            continue
        row = {'path': obj.get_path_name(), 'class': obj.get_class().get_name(), 'fields': {}}
        for field in fields:
            try:
                value = obj.get_editor_property(field)
                row['fields'][field] = value if isinstance(value, (str, int, float, bool)) else value.get_path_name() if isinstance(value, unreal.Object) else str(value)
            except Exception as error:
                row['fields'][field] = {'unavailable': str(error)[:220]}
        report['expressions'].append(row)
for name in ['MI_Flame_1', 'MI_Flame_2', 'MI_Smoke_1']:
    obj = unreal.load_asset('/Game/sA_Megapack_v1/sA_StylizedAttacksPack/Materials/' + name)
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
