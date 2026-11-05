"""Execute trusted Python, preserve native/exported artifacts, then render a preview."""
import math
import os
import runpy

import bpy
from mathutils import Vector


root = os.getcwd()
bpy.ops.wm.read_factory_settings(use_empty=True)
runpy.run_path(os.path.join(root, "user.py"), run_name="__main__")
if bpy.context.object and bpy.context.object.mode != "OBJECT":
    bpy.ops.object.mode_set(mode="OBJECT")
bpy.context.view_layer.update()

# Preserve the script's project, including unapplied modifiers and authored rig.
# Generated images need explicit packing; pack_all covers file/tiled textures.
for image in bpy.data.images:
    if image.source == "GENERATED" or (image.source in {"FILE", "TILED"} and image.is_dirty):
        # Accessing size initializes a lazily generated image buffer.
        if image.size[0] and image.size[1]:
            if image.source == "GENERATED" and not image.is_dirty:
                # Blender leaves clean generated buffers unpacked unless dirty.
                # Mark the existing pixel data dirty without changing its value.
                image.pixels[0] = image.pixels[0]
            image.pack()
if "FINISHED" not in bpy.ops.file.pack_all():
    raise RuntimeError("Packing project resources failed")
for image in bpy.data.images:
    if image.library is None and image.source in {"GENERATED", "FILE", "TILED"} and not image.packed_files:
        raise RuntimeError("Image could not be packed: " + image.name)
if "FINISHED" not in bpy.ops.wm.save_as_mainfile(
        filepath=os.path.join(root, "result.blend"), check_existing=False, compress=False):
    raise RuntimeError("Saving Blender project failed")

# The exporter evaluates modifiers on temporary meshes without applying them to
# the saved Blender project. In particular, bevels must survive static export.
if "FINISHED" not in bpy.ops.export_scene.gltf(
        filepath=os.path.join(root, "result.glb"), export_format="GLB",
        export_apply=True, export_current_frame=True, export_cameras=True, export_lights=True):
    raise RuntimeError("GLB export failed")

scene = bpy.context.scene


def geometry_bounds():
    points = []
    count = 0
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for instance in depsgraph.object_instances:
        obj = instance.object
        if obj.type not in {"MESH", "CURVE", "SURFACE", "META", "FONT", "VOLUME"} or obj.hide_render:
            continue
        count += 1
        if count > 1200:
            raise RuntimeError("Auto-frame exceeds 1200 geometry instances")
        points.extend(instance.matrix_world @ Vector(corner) for corner in obj.bound_box)
    if not points or any(not math.isfinite(value) for point in points for value in point):
        raise RuntimeError("Auto-frame requires finite visible geometry bounds")
    lo = Vector(tuple(min(point[i] for point in points) for i in range(3)))
    hi = Vector(tuple(max(point[i] for point in points) for i in range(3)))
    span = (hi - lo).length
    if not math.isfinite(span) or span > 1e12:
        raise RuntimeError("Auto-frame geometry extent is too large")
    return (lo + hi) / 2, max(span, 0.01)


# All preview-only changes happen after both downloadable model files exist.
# Never write the project again or add the studio rig to the GLB.
if scene.camera is None:
    scene.camera = next((obj for obj in scene.objects if obj.type == "CAMERA" and not obj.hide_render), None)
needs_camera = scene.camera is None
needs_lights = not any(obj.type == "LIGHT" and not obj.hide_render and obj.data.energy > 0 for obj in scene.objects)
if needs_camera or needs_lights:
    centre, span = geometry_bounds()
    if needs_camera:
        data = bpy.data.cameras.new("Preview camera")
        camera = bpy.data.objects.new("Preview camera", data)
        scene.collection.objects.link(camera)
        camera.location = centre + Vector((1, -1.5, 1)).normalized() * span * 3
        camera.rotation_euler = (centre - camera.location).to_track_quat("-Z", "Y").to_euler()
        data.type = "ORTHO"
        data.ortho_scale = span * 1.15
        data.clip_start = max(span * 0.0001, 0.000001)
        data.clip_end = span * 10
        scene.camera = camera
    if needs_lights:
        for index, (offset, power) in enumerate([
                ((-0.7, -1, 1.8), 900), ((1, -0.2, 0.8), 450), ((0, 1, 1.5), 700)]):
            data = bpy.data.lights.new("Preview studio " + str(index), "AREA")
            light = bpy.data.objects.new(data.name, data)
            scene.collection.objects.link(light)
            light.location = centre + Vector(offset) * span
            light.rotation_euler = (centre - light.location).to_track_quat("-Z", "Y").to_euler()
            data.energy = power * span * span
            data.size = span

# Keep authored framing, lights, world, materials and color management. Bound
# only preview work; the script's original render settings remain in .blend.
width = max(1, scene.render.resolution_x)
height = max(1, scene.render.resolution_y)
scale = min(1.0, 768 / max(width, height))
scene.render.resolution_x = max(1, round(width * scale))
scene.render.resolution_y = max(1, round(height * scale))
scene.render.resolution_percentage = 100
if needs_camera:
    scene.camera.data.ortho_scale *= max(1, scene.render.resolution_y / scene.render.resolution_x)
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = min(max(1, scene.cycles.samples), 12)
scene.cycles.use_denoising = True
scene.cycles.time_limit = 35
scene.render.use_sequencer = False
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.color_depth = "8"
scene.render.filepath = os.path.join(root, "render.png")
scene.render.use_file_extension = True
if "FINISHED" not in bpy.ops.render.render(write_still=True):
    raise RuntimeError("Blender preview render failed")
