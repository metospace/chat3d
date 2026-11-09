"""Deterministic multi-part geometry for the local arbitrary-Python smoke test."""
import math
import bpy

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def box(name, center, dimensions):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    part = bpy.context.object
    part.name = name
    part.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

box('Chassis', (0, 0, .20), (1.3, .74, .18))
box('Battery cover', (.12, 0, .37), (.76, .63, .20))
for x in (-.44, .44):
    for y in (-.38, .38):
        bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=.14, depth=.11,
            location=(x,y,.14), rotation=(math.pi/2,0,0))
        bpy.context.object.name = f'Wheel {x} {y}'
for y in (-.22, .22):
    box(f'Mast {y}', (-.4,y,.81), (.09,.09,1.15))
    box(f'Fork {y}', (-.78,y,.17), (.65,.09,.05))
