import type {Material} from '../domain/types';
const palette:[string,string,number,number,number?][]=[['panel','#e2e9e8',.48,.13],['bright','#f7faf7',.48,.05],['dark','#293a40',.68,.15],['base','#586f78',.8,.05],['teal','#407e79',.48,.20],['blue','#6a8799',.52,.2],['steel','#a6b8bd',.34,.7],['rubber','#26343a',.9,0],['glass','#345362',.23,.28,.67],['screen','#153c47',.38,.15],['green','#52c5a2',.35,.1],['yellow','#dbb358',.65,0],['red','#c26050',.55,0],['floor','#b8c7ca',.88,0],['lane','#839b9e',.92,0],['zone','#a6bcbd',.92,0],['pcb','#256958',.58,0],['box','#b09d7b',.87,0],['skin','#c5ad99',.88,0],['uniform','#587f8c',.85,0],['pants','#3b5361',.85,0],['cap','#e1e9e6',.92,0],['label','#42626a',1,0]];
const coated=new Set(['panel','bright','teal','blue','yellow','red']);
export const WORKSHOP_MATERIALS:Material[]=palette.map(([id,baseColor,roughness])=>({
 id:'ws_'+id,baseColor,roughness,metalness:id==='steel'?1:0,
 ...(coated.has(id)?{clearcoat:.18,clearcoatRoughness:.32,surface:{preset:'powder_coat' as const,repeat:[8,8] as [number,number],strength:.07}}:{}),
 ...(id==='steel'?{surface:{preset:'brushed_metal' as const,repeat:[6,6] as [number,number],strength:.14}}:{}),
 ...(['uniform','pants'].includes(id)?{surface:{preset:'fabric' as const,repeat:[12,12] as [number,number],strength:.12}}:{}),
 ...(id==='glass'?{baseColor:'#DCE9EB',roughness:.09,opacity:1,transmission:.92,ior:1.5,thickness:.008}:{}),
 ...(id==='screen'?{emissive:'#1f6468',emissiveIntensity:.2}:{}),
}));
