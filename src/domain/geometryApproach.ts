import type {ObjectBlueprint} from './objectBlueprint';
import type {SceneNode} from './types';
export function matchesGeometryApproach(approach:ObjectBlueprint['features'][number]['geometryApproach'],nodes:SceneNode[]):boolean{
 const types=nodes.map(n=>n.geometry?.type);if(!types.length)return false;switch(approach){case 'profile':return types.every(t=>t==='profile'||t==='roundedPlate');case 'lathe':return types.every(t=>t==='lathe');case 'sweep':return types.every(t=>t==='profileSweep'||t==='sweepTube'||t==='loft'||t==='sectionLoft');case 'mesh':return types.every(t=>t==='mesh');case 'assembly':return nodes.length>=2;case 'primitive':return types.some(t=>!!t&&t!=='mesh');}
}
