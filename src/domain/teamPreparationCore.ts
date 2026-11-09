import {validateModelAsset,type ModelAssetVersion} from './modelAssets';
import {MAX_TEAM_SCENE_BYTES,serializeProject} from './project';
import type {SceneDocument} from './types';
import type {TeamPublish} from './teamLibrary';
import {projectAssetSnapshot,projectSceneSnapshot} from './teamPublicationSnapshot';
import {fingerprintTeamContent} from './teamFingerprint';
export interface TeamPreparationProgress {stage:string;completed:number;total:number;name?:string}
export interface TeamPreparationInput {
 kind:'asset'|'scene';name:string;description:string;category?:string;categoryPath:string[];key:string;expectedVersion:number;itemId?:string;
 asset?:{id:string;version:number};scene?:SceneDocument;
}
export interface TeamPreparationResult {request:TeamPublish;serializedBody:string;bytes:number;baselineFingerprint:string}
export async function fingerprintSavedTeamContent(input:Pick<TeamPreparationInput,'kind'|'name'|'description'|'category'>,payload:unknown){return fingerprintTeamContent({kind:input.kind,name:input.name,description:input.description,category:input.category,payload:input.kind==='scene'?JSON.parse(serializeProject(payload as SceneDocument)):payload});}
export async function constructTeamPreparation(input:TeamPreparationInput,localPayload:unknown,onStage?:(stage:string)=>void):Promise<TeamPreparationResult>{
 onStage?.('sanitizing');
 const safe=input.kind==='asset'?projectAssetSnapshot({...localPayload as ModelAssetVersion,name:input.name,description:input.description,category:input.category!}):projectSceneSnapshot(localPayload as SceneDocument);
 onStage?.('validating');
 let payload:unknown;
 if(input.kind==='asset'){validateModelAsset(safe as ModelAssetVersion);payload=safe;}
 else payload=JSON.parse(serializeProject(safe as SceneDocument,undefined,MAX_TEAM_SCENE_BYTES));
 onStage?.('fingerprinting');
 const baselineFingerprint=await fingerprintSavedTeamContent({kind:input.kind,name:input.name,description:input.description,category:input.category},localPayload);
 onStage?.('serializing');
 const request:TeamPublish={kind:input.kind,name:input.name,description:input.description,payload,categoryPath:input.categoryPath,key:input.key,expectedVersion:input.expectedVersion,...(input.itemId?{itemId:input.itemId}:{})};
 const serializedBody=JSON.stringify(request),bytes=new TextEncoder().encode(serializedBody).byteLength;
 return {request,serializedBody,bytes,baselineFingerprint};
}
