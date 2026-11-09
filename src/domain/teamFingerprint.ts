export interface TeamFingerprintInput {kind:'asset'|'scene';payload:unknown;name:string;description?:string;category?:string}
// Object keys retain the original localeCompare ordering. Primitive arrays need
// neither a second array nor a recursive callback for each mesh coordinate.
function canonical(value:unknown):unknown {
 if(Array.isArray(value)){
  let complex=false;for(let i=0;i<value.length;i++)if(value[i]!==null&&typeof value[i]==='object'){complex=true;break;}
  return complex?value.map(canonical):value;
 }
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
 return value;
}
export async function fingerprintTeamContent(value:TeamFingerprintInput){
 const bytes=new TextEncoder().encode(JSON.stringify(canonical({...value,description:value.description??'',category:value.category??''})));
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
}
