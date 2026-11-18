/* Called only inside an opaque-origin worker with connect-src 'none'. */
async function runModelingProgramWorker(THREE,serializeModelingObject,event) {
  const stringify=JSON.stringify.bind(JSON);
  const compile=Function;
  const convert=serializeModelingObject;
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
    if(typeof source!=='string')throw Error('建模程序需为非空函数体');
    let root;
    try{
      root=await compile('THREE','"use strict";\n'+source)(THREE);
    }catch(error){
      const stack=typeof error?.stack==='string'?error.stack:'';
      const frames=[...stack.matchAll(/<anonymous>:(\d+):(\d+)\)?(?:\r?\n|$)/g)];
      const locations=frames.map(([,line,column])=>({line:Number(line)-3,column})).filter(p=>p.line>0).slice(0,3);
      const where=locations.map(({line,column})=>`第 ${line} 行，第 ${column} 列`).join(' ← ');
      const hint=error?.message==='Cannot convert undefined or null to object'&&stack.includes('Mesh.updateMorphTargets')
        ?'；检查 new THREE.Mesh(geometry, material)：第一个参数必须是 BufferGeometry，不要把材质传到第一位。':'';
      throw Error(`建模脚本运行失败${where?'（'+where+'）':''}：${String(error?.message||error)}${hint}`);
    }
    const result=stringify(convert(THREE,root));
    reply({result});
  }catch(error){reply({error:String(error?.message||error).slice(0,2000)});}
  finally{close();}
}
