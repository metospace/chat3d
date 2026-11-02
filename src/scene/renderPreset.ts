export type RenderPreset = 'studio' | 'classic';
export const RENDER_PRESET_KEY = 'chat3d.renderPreset.v1';
export const normalizeRenderPreset = (value:unknown):RenderPreset => value === 'classic' ? 'classic' : 'studio';
let sessionPreset:RenderPreset='studio';
export function loadRenderPreset():RenderPreset {
  try {return sessionPreset=normalizeRenderPreset(localStorage.getItem(RENDER_PRESET_KEY));} catch {return sessionPreset;}
}
export function saveRenderPreset(value:RenderPreset):void {
  sessionPreset=value;
  try {localStorage.setItem(RENDER_PRESET_KEY,value);} catch { /* Session selection still works. */ }
}
export const RENDER_PRESETS = {
  studio: {exposure:1,environment:.8,hemisphere:.35,key:2.6,rim:.35,sky:'#ffffff',ground:'#7f858c',keyColor:'#fff9f0',rimColor:'#eef3fa'},
  classic: {exposure:1.02,environment:.55,hemisphere:1.10,key:2,rim:1,sky:'#f5fcff',ground:'#789095',keyColor:'#fff5e4',rimColor:'#b7d5ee'},
} as const;
