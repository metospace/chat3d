import {readModelAsset} from './modelAssetStorage';
import {constructTeamPreparation,fingerprintSavedTeamContent,type TeamPreparationInput} from './teamPreparationCore';
import {fingerprintTeamContent,type TeamFingerprintInput} from './teamFingerprint';
import {preparationReceiver,type PreparationWireRecord,type PreparationWireValue} from './teamPreparationWire';
export type TeamPreparationWorkerRequest=
 |{type:'chunk';records:PreparationWireRecord[]}
 |{type:'prepare';input:TeamPreparationInput;root?:PreparationWireValue}
 |{type:'fingerprint';root:PreparationWireValue}
 |{type:'savedFingerprint';input:Pick<TeamPreparationInput,'kind'|'name'|'description'|'category'|'asset'>;root?:PreparationWireValue};
const scope=globalThis as unknown as {onmessage:((event:MessageEvent<TeamPreparationWorkerRequest>)=>void)|null;postMessage:(value:unknown,transfer?:Transferable[])=>void};
const receiver=preparationReceiver();
scope.onmessage=async event=>{
 try{
  const message=event.data;
  if(message.type==='chunk'){receiver.accept(message.records);scope.postMessage({type:'ack'});return;}
  if(message.type==='fingerprint'){const fingerprint=await fingerprintTeamContent(receiver.get(message.root) as TeamFingerprintInput);receiver.clear();scope.postMessage({type:'fingerprint',fingerprint});return;}
  if(message.type==='savedFingerprint'){const payload=message.input.asset?await readModelAsset(message.input.asset.id,message.input.asset.version):receiver.get(message.root);const fingerprint=await fingerprintSavedTeamContent(message.input,payload);receiver.clear();scope.postMessage({type:'fingerprint',fingerprint});return;}
  const input=message.input;
  scope.postMessage({type:'progress',stage:'reading'});
  const localPayload=input.asset?await readModelAsset(input.asset.id,input.asset.version):receiver.get(message.root);
  receiver.clear();
  const result=await constructTeamPreparation(input,localPayload,stage=>scope.postMessage({type:'progress',stage}));
  // Transfer the compressed bytes, not a cloned expanded JSON string or geometry.
  const request=result.request;
  const metadata={kind:request.kind,name:request.name,description:request.description,categoryPath:request.categoryPath,key:request.key,expectedVersion:request.expectedVersion,...(request.itemId?{itemId:request.itemId}:{})};
  scope.postMessage({type:'result',...result,request:metadata},[result.publication.data.buffer as ArrayBuffer]);
 }catch(error){receiver.clear();scope.postMessage({type:'error',message:error instanceof Error?error.message:String(error)});}
};
