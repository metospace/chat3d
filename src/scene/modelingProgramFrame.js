/* Trusted supervisor. Only this opaque frame owns workers and their blob URLs. */
(() => {
  'use strict';
  const parentChannel=new MessageChannel();
  const port=parentChannel.port1;
  let worker,workerPort,timer,closed=false;
  const urls=[];
  const cleanup=()=>{
    if(closed)return;
    closed=true;
    clearTimeout(timer);
    workerPort?.close();
    worker?.terminate();worker=null;
    for(const url of urls)URL.revokeObjectURL(url);
    urls.length=0;
    window.removeEventListener('pagehide',cleanup);
    port?.close();
  };
  const fail=message=>{if(!closed)port?.postMessage({error:String(message).slice(0,2000),disposed:true});cleanup();};
  const blob=source=>{const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));urls.push(url);return url;};
  port.onmessage=message=>{
      if(message.data?.type==='dispose'){port.postMessage({disposed:true});cleanup();return;}
      if(message.data?.type!=='run'||worker||closed)return;
      try{
        const {source,core,module,converter,workerSource,resultBytes}=message.data;
        const coreUrl=blob(core);
        const moduleUrl=blob(module.split("'./three.core.js'").join(JSON.stringify(coreUrl)));
        const converterUrl=blob(converter);
        // Opaque-origin module worker entrypoints fail CORS in Chromium. A classic
        // blob worker may import these same local modules without gaining an origin.
        const bootstrap=`${workerSource}\nconst runtime=Promise.all([import(${JSON.stringify(moduleUrl)}),import(${JSON.stringify(converterUrl)})]);\nself.onmessage=async event=>{self.onmessage=null;try{const [THREE,converter]=await runtime;await runModelingProgramWorker(THREE,converter.serializeModelingObject,converter.MODELING_PROGRAM_LIMITS,event);}catch(error){event.ports[0]?.postMessage({error:String(error?.message||error)});}};`;
        worker=new Worker(blob(bootstrap),{name:'isolated-modeling-program'});
        const channel=new MessageChannel();
        workerPort=channel.port1;
        workerPort.onmessage=message=>{
          if(closed)return;
          if(typeof message.data?.result==='string'&&message.data.result.length<=resultBytes){port.postMessage({result:message.data.result,disposed:true});cleanup();}
          else fail(message.data?.error||'建模程序返回数据无效或超过预算');
        };
        workerPort.onmessageerror=()=>fail('建模程序返回的数据无法读取');
        workerPort.start();
        worker.onerror=event=>{event.preventDefault();fail(event.message||'无法启动隔离建模程序');};
        timer=setTimeout(()=>fail('建模程序运行超过15秒，已终止'),15000);
        worker.postMessage({source},[channel.port2]);
      }catch(error){fail(error?.message||'无法启动隔离建模程序');}
  };
  port.onmessageerror=()=>fail('隔离建模通信失败');
  port.start();
  parent.postMessage({type:'modeling-program-ready',id:document.currentScript.dataset.id},'*',[parentChannel.port2]);
  window.addEventListener('pagehide',cleanup);
})();
