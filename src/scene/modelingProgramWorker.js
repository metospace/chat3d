/* Called only inside an opaque-origin worker with connect-src 'none'. */
async function runModelingProgramWorker(THREE,serializeModelingObject,MODELING_PROGRAM_LIMITS,event) {
  const stringify=JSON.stringify.bind(JSON);
  const encode=new TextEncoder().encode.bind(new TextEncoder());
  const compile=Function;
  const convert=serializeModelingObject;
  const limits=MODELING_PROGRAM_LIMITS;
  const fail=()=>{throw Error('隔离建模程序不能使用网络、存储或应用 API');};
  // CSP and the opaque origin are the security boundary. These explicit removals
  // also make accidental API use fail immediately, without depending on promises.
  for(const key of ['fetch','XMLHttpRequest','WebSocket','WebTransport','EventSource','Worker','SharedWorker','importScripts','indexedDB','caches','postMessage','close']){
    Object.defineProperty(globalThis,key,{value:fail,writable:false,configurable:false});
  }
  const port=event.ports[0];
  if(!port)return;
  const reply=port.postMessage.bind(port),close=port.close.bind(port);
  try{
    const source=event.data?.source;
    if(typeof source!=='string'||encode(source).byteLength>limits.sourceBytes)throw Error('建模程序源代码超过256KB预算');
    const root=await compile('THREE','"use strict";\n'+source)(THREE);
    const result=stringify(convert(THREE,root));
    if(result.length>limits.resultBytes||encode(result).byteLength>limits.resultBytes)throw Error('建模程序结果超过24MB预算');
    reply({result});
  }catch(error){reply({error:String(error?.message||error).slice(0,2000)});}
  finally{close();}
}
