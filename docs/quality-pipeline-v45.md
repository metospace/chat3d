# Quality pipeline upgrade

## Implemented

- Batch placement of 1–16 detailed components in a single atomic draft update. Each component still has its own identity, placement, and role.
- Targeted part queries with real identifiers, transforms, world bounding boxes, UV availability, pagination and catalogue keyword hints. Tests compare the same machine's full context with a local control-panel query; this is a text-size measurement, not a claim about actual provider token cost.
- Persistent contact relationships with source/target local points, tolerance, purpose and distance diagnostics. Optional alignment translates only the source assembly; it does not rotate, rig, resolve collisions or prove process correctness.
- Embedded PNG/JPEG PBR map import with first-set UVs, normal strength, alpha masks/blending and double-sided materials. No external URLs or SVG textures. The former 2048-pixel side limit is removed from validation and image loading. Default imports preserve original image bytes, including 4K/8K textures, without automatic resizing or recompression. Limits: 16 MiB per encoded image, 128 MiB original GLB image bytes, 192 MiB encoded material-map data summed per material slot, 512 MiB GLB, and 400 MiB local/team JSON content and whole-library/workspace backups. A 64 Mi-pixel decoded-image budget (67,108,864 pixels, approximately 256 MiB RGBA before mipmaps) remains. GPU texture-size limits are device-dependent. JSON is still buffered/parsed as a whole and can consume substantially more memory than its file size; raised byte limits do not guarantee rendering performance.
- Optional import fitting is available explicitly through `importGlb(data, name, onStage, {fitTextures:true})` or `inspectGlbBytes(data, {fitTextures:true})`. It scales source edges proportionally to at most 4096, re-encodes PNG and, only if necessary, compresses opaque images with descending JPEG quality to the 16 MiB image budget. Alpha is never silently flattened; an image that cannot fit reports a compression error. The same 16 MiB source, 64 Mi-pixel decoded-image and 128 MiB original GLB image budgets apply in fit mode; stored/project textures still have no fixed edge cap.
- Procedural surface normal/roughness detail, and optional planar/cylindrical UV projection for unwrapped mesh parts. Projection preserves geometry but is not professional unwrapping and requires seam/stretch review.
- Multi-view capture including rear/left views. A passing detail self-review requires at least two actual current-revision views plus real part identifiers. Missing evidence stays incomplete.
- Optional local Blender inspection rendering. It renders supplied geometry using trusted application code; it does not execute model-provided Python. See server/blender/README.md.

## Still pending

- Installation and evaluation of the community Blender Agent Studio plugin: user confirmation is pending.
- A reviewed, persistent Blender modeling service and production authentication/isolation. The private Sites runtime cannot launch Blender and reports this service unavailable.
- End-to-end arbitrary-model quality acceptance. Technical tests, existing high-detail meshes and reviewer claims do not prove visual quality for every future request.
- Repeatable cross-domain live-provider visual acceptance. One workshop comparison already ran: v42 604218 tokens/22 rounds/307s; v46 381614 tokens/15 rounds/307s. One run per version, not statistical evidence or a speedup.

## Meaning of results

Connection distances are geometric measurements only. Detail reviews are model self-reviews, never automatic human acceptance. Existing saved models do not change on refresh; a new refinement request is required.
