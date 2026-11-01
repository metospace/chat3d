import { WORKSHOP_MATERIALS } from '../workshop/materials';
import { Material, SceneDocument, type SceneRole } from './types';
export const SCENE_ROLE_MATERIALS:Record<SceneRole,string>={equipment:'mat_paint',conveyor:'mat_brushed',workstation:'mat_paint',storage:'mat_blue',person:'mat_fabric',safety:'mat_yellow',building:'mat_wall',floor:'mat_floor',transport:'mat_dark',other:'mat_gray'};
export const EXTRA_MATERIALS: Material[] = [...WORKSHOP_MATERIALS,
  {id:'mat_floor',baseColor:'#73858A',roughness:.78,metalness:0},
  {id:'mat_wall',baseColor:'#D2D9D8',roughness:.92,metalness:0},
  {id:'mat_paint',baseColor:'#D7E0E3',roughness:.42,metalness:0,clearcoat:.22,clearcoatRoughness:.3,surface:{preset:'powder_coat',repeat:[8,8],strength:.08}},
  {id:'mat_brushed',baseColor:'#B3B8BE',roughness:.3,metalness:1,surface:{preset:'brushed_metal',repeat:[6,6],strength:.14}},
  {id:'mat_fabric',baseColor:'#365D72',roughness:.92,metalness:0,surface:{preset:'fabric',repeat:[12,12],strength:.12}},
  {id:'mat_skin',baseColor:'#BF9273',roughness:.9,metalness:0},
  {id:'mat_light',baseColor:'#E3EEE8',roughness:.3,metalness:0,emissive:'#D9F0ED',emissiveIntensity:.6},
  {id:'mat_glass',baseColor:'#DCE9EB',roughness:.09,metalness:0,opacity:1,transmission:.92,ior:1.5,thickness:.008},
  {id:'mat_screen',baseColor:'#123C52',roughness:0.28,metalness:0},
  {id:'mat_pcb',baseColor:'#205743',roughness:0.65,metalness:0},
  {id:'mat_green',baseColor:'#42BA8A',roughness:0.28,metalness:0},
  {id:'mat_red',baseColor:'#B9232C',roughness:0.42,metalness:0},
  {id:'mat_cyan',baseColor:'#A0F2EF',roughness:0.3,metalness:0},
  {id:'mat_black',baseColor:'#111315',roughness:0.46,metalness:0},
];
// Add missing stock colors without overwriting any existing project's custom materials.
export function withStockMaterials(doc: SceneDocument): SceneDocument {
  return {...doc,materials:[...doc.materials,...EXTRA_MATERIALS.filter(m=>!doc.materials.some(existing=>existing.id===m.id)).map(m=>({...m}))]};
}
