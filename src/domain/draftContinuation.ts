import {applyBatch,type CommandBatch,type ExecutionResult} from './commands';
import {checkEditScope} from './editScope';
import type {SceneDocument} from './types';
export interface DraftBaseline {batch:CommandBatch;result:ExecutionResult}
// Execute the delta against the visible draft, then compose transaction history without
// replaying creations (which would allocate different IDs). Every delta is scope checked.
export function continueDraft(base:SceneDocument,parent:DraftBaseline|null,batch:CommandBatch,prepared?:ExecutionResult):DraftBaseline{
 const working=parent?.result.doc??base;
 if(batch.projectId!==working.projectId||batch.baseRevision!==working.revision)throw new Error('草稿基线已变化，请重新发送');
 if(parent&&(parent.batch.projectId!==base.projectId||parent.batch.baseRevision!==base.revision))throw new Error('原场景已变化，不能合并旧预览');
 const result=prepared??applyBatch(working,{operations:batch.operations});
 if(result.errors.length)throw new Error(result.errors.map(e=>e.message).join('；'));
 const errors=checkEditScope(working,result.doc,batch.editScope);if(errors.length)throw new Error(errors.join('；'));
 if(!parent)return {batch,result};
 return {batch:{...batch,baseRevision:base.revision,operations:[...parent.batch.operations,...batch.operations],editScope:undefined},result:{doc:result.doc,applied:[...parent.result.applied,...result.applied],errors:[]}};
}
