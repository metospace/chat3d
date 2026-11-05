import {parseModelAsset} from '../../src/domain/modelAssets';
import {MAX_TEAM_SCENE_BYTES,parseProject} from '../../src/domain/project';

export function validateTeamPayload(kind:string,payload:unknown){
 try{const text=JSON.stringify(payload);if(kind==='asset')parseModelAsset(text);else parseProject(text,MAX_TEAM_SCENE_BYTES);}
 catch(e){throw Object.assign(e instanceof Error?e:Error('发布内容无效'),{status:400});}
}
