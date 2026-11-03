"""Export the existing Unity project's authored Bunny, without changing the source.

Blender --background --factory-startup --python tools/export-assets/bunny.py
Optional arguments after --: --source /path/to/bunny_rigged.blend
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import bpy

project = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--model', choices=['bunny', 'sumo'], default='bunny')
parser.add_argument('--source', type=Path)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
source = (args.source or project.parent / f'Super Bunny/ArtSource/{args.model}_rigged.blend').resolve()
bpy.ops.wm.open_mainfile(filepath=str(source))

required = {'Root', 'Spine', 'Head', 'Belly'} | {
    f'{bone}.{side}' for side in ('L', 'R')
    for bone in ('UpperArm', 'Forearm', 'Mitten', 'Thigh', 'Shin', 'Foot')
}
if args.model == 'bunny': required |= {'Tail', 'Ear1.L', 'Ear1.R', 'Ear2.L', 'Ear2.R'}
rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
assert required <= set(rig.data.bones.keys()), 'Missing Bunny rig bones'
for image in bpy.data.images:
    if not image.users or image.packed_file or image.type in {'RENDER_RESULT', 'COMPOSITING'}:
        continue
    if image.source == 'GENERATED':
        image.pack()
        continue
    image.filepath = bpy.path.abspath(image.filepath)
    assert Path(image.filepath).is_file(), f'Missing texture: {image.filepath}'
    image.reload()
    image.pack()

# Keep both source faces; runtime switches the visible face on death.
if bpy.data.objects.get('FaceDead'):
    bpy.data.objects['FaceDead'].hide_render = False
    bpy.data.objects['FaceDead'].hide_viewport = False
for obj in bpy.context.scene.objects:
    obj.select_set(obj.type in {'ARMATURE', 'MESH'})

output = project / f'public/assets/models/{args.model}.glb'
output.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=str(output), export_format='GLB', use_selection=True,
    export_yup=True, export_animations=False, export_skins=True,
    export_all_influences=False, export_apply=False,
    export_normals=True, export_texcoords=True, export_materials='EXPORT',
    export_extras=True, export_cameras=False, export_lights=False,
)
manifest = {
    'source': f'Super Bunny/ArtSource/{args.model}_rigged.blend',
    'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'assetSha256': hashlib.sha256(output.read_bytes()).hexdigest(),
    'coordinates': 'glTF Y up; authored front +Z; metres; profile yaw +65 degrees',
    'bones': sorted(rig.data.bones.keys()),
    'meshes': {o.name: len(o.data.vertices) for o in bpy.data.objects if o.type == 'MESH'},
    'materials': {m.name: list(m.diffuse_color) for m in bpy.data.materials if m.users},
    'note': 'Original geometry, normals, skin and face texture; no decimation. FaceDead included for deathmatch.'
}
output.with_suffix('.source.json').write_text(json.dumps(manifest, indent=2) + '\n')
print('BUNNY_EXPORT_OK', output, output.stat().st_size)
