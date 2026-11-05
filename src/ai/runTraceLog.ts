export interface DiagnosticEntry {at:number;kind:string;data:unknown}
const secretField=/^(?:api[_-]?key|authorization|proxy-authorization|access[_-]?token|refresh[_-]?token|password|secret|token|x-chat3d-python)$/i;
/** Keep task content intact; exclude only credentials and execution tokens. */
export function sanitizeDiagnostic<T>(value:T,apiKey?:string):T {
 const seen=new WeakSet<object>();
 const visit=(input:unknown):unknown=>{
  if(typeof input==='string'){
   const text=apiKey&&input.includes(apiKey)?input.split(apiKey).join('[凭证已排除]'):input;
   return text.replace(/\bBearer[ \t]+[A-Za-z0-9._~+/-]+=*|\bsk-[A-Za-z0-9_-]{8,}/gi,'[凭证已排除]');
  }
  if(!input||typeof input!=='object')return input;
  if(seen.has(input))return '[循环引用]';
  seen.add(input);
  let output:unknown;
  if(input instanceof Error)output={name:input.name,message:visit(input.message),stack:visit(input.stack),...Object.fromEntries(Object.entries(input).filter(([key])=>!secretField.test(key)).map(([key,child])=>[key,visit(child)]))};
  else if(Array.isArray(input))output=input.map(visit);
  else output=Object.fromEntries(Object.entries(input).filter(([key])=>!secretField.test(key)).map(([key,child])=>[key,visit(child)]));
  seen.delete(input);return output;
 };
 return visit(value) as T;
}
export function createRunTraceLog(apiKey:string){
 const entries:DiagnosticEntry[]=[];
 return {entries,record(kind:string,data:unknown){
  const safe=sanitizeDiagnostic(data,apiKey),last=entries[entries.length-1];
  if(kind==='provider_event'&&last?.kind===kind){const values=last.data as unknown[];values.push(safe);return;}
  entries.push({at:Date.now(),kind,data:kind==='provider_event'?[safe]:safe});
 }};
}
