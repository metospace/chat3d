"""Generate only allowlisted geometry in a disposable Blender process."""
import json
import sys
from pathlib import Path

import bpy

folder = Path(sys.argv[sys.argv.index('--') + 1])
spec = json.loads((folder / 'spec.json').read_text(encoding='utf-8'))
bpy.ops.wm.read_factory_settings(use_empty=True)

# Blender and glTF use meters; the request uses millimeters.
mm = 0.001
height = spec['thickness'] * mm
kind = spec['type']
if kind == 'cylinder':
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=spec['diameter'] * mm / 2, depth=height, location=(0, 0, height/2))
    part = bpy.context.object
else:
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, height/2))
    part = bpy.context.object
    part.dimensions = (spec['width'] * mm, spec['depth'] * mm, height)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
part.name = kind


def drill(x, y):
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=spec['holeDiameter'] * mm / 2, depth=height * 3, location=(x, y, height/2))
    cutter = bpy.context.object
    bpy.context.view_layer.objects.active = part
    modifier = part.modifiers.new(name='Through hole', type='BOOLEAN')
    modifier.operation = 'DIFFERENCE'
    modifier.solver = 'EXACT'
    modifier.object = cutter
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


if kind == 'mounting_plate':
    dx = (spec['width']/2 - spec['holeInset']) * mm
    dy = (spec['depth']/2 - spec['holeInset']) * mm
    for x in (-dx, dx):
        for y in (-dy, dy):
            drill(x, y)
elif kind == 'cylinder' and spec['holeDiameter']:
    drill(0, 0)

bpy.context.view_layer.objects.active = part
part.select_set(True)
if spec['bevel']:
    bevel = part.modifiers.new(name='Edge chamfer', type='BEVEL')
    bevel.width = spec['bevel'] * mm
    bevel.segments = 1
    bevel.limit_method = 'ANGLE'
    bpy.ops.object.modifier_apply(modifier=bevel.name)

bpy.ops.export_scene.gltf(filepath=str(folder / 'result.glb'), export_format='GLB', use_selection=True)
