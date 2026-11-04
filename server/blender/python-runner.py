import os
import runpy

import bpy

root = os.getcwd()
bpy.ops.wm.read_factory_settings(use_empty=True)
runpy.run_path(os.path.join(root, "user.py"), run_name="__main__")
result = bpy.ops.export_scene.gltf(filepath=os.path.join(root, "result.glb"), export_format="GLB")
if "FINISHED" not in result:
    raise RuntimeError("GLB export failed")
