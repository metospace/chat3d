import {isThumbnailImage} from '../domain/thumbnailImage';
import type {SceneDocument} from '../domain/types';
import {captureIsolatedSceneEvidence,type EvidenceCapture} from './capture';
/** Same scene renderer, lights, tone mapping and color output as the live viewport. */
export async function captureLibraryThumbnail(doc:SceneDocument,capture:EvidenceCapture=captureIsolatedSceneEvidence){
 const projectId=doc.projectId,revision=doc.revision;const result=await capture(doc,'perspective');
 if(result.projectId!==projectId||result.revision!==revision||doc.projectId!==projectId||doc.revision!==revision)throw Error('预览图与当前模型不一致，请重试');
 if(!isThumbnailImage(result.image))throw Error('预览图格式无效或过大，模型数据不受影响');
 return {image:result.image,notice:result.backend==='webgl'?'缩略图已按工作台的材质和光照生成。':result.backend==='software'?'当前三维渲染不可用，缩略图仅用于查看形状，颜色与材质可能不一致。':'缩略图由备用渲染服务生成，颜色请以工作台实际显示为准。'};
}
