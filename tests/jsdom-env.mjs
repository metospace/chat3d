import {createRequire,registerHooks} from 'node:module';
const require=createRequire(import.meta.url);
// ProComponents 3.1.14-2's CommonJS provider imports antd's ES locale entry.
// Node component tests need its equivalent CommonJS entry; browser builds keep the published ES code.
registerHooks({resolve(specifier,context,nextResolve){
  return nextResolve(specifier==='antd/es/locale/zh_CN'?require.resolve('antd/lib/locale/zh_CN'):specifier,context);
}});

// jsdom keeps DOM constructors on the window only and has no matchMedia. antd (and therefore Ant
// Design X) reads both while mounting, so every test that renders the chat surface installs these
// after creating its JSDOM instance and before importing React DOM.
export function installBrowserGlobals(dom){
  globalThis.getComputedStyle=(element)=>dom.window.getComputedStyle(element);
  for(const name of Object.getOwnPropertyNames(dom.window)){
    if(!/^[A-Z]/.test(name))continue;
    let value;
    try{value=dom.window[name];}catch{continue;}
    if(typeof value==='function'&&!Object.prototype.hasOwnProperty.call(globalThis,name))Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
  }
  const mediaQuery=()=>({matches:false,media:'',onchange:null,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent(){return false}});
  const matchMedia=dom.window.matchMedia??mediaQuery;
  globalThis.matchMedia=matchMedia;dom.window.matchMedia=matchMedia;
  // Bubble.List's real scroll API is absent from jsdom.
  if(!dom.window.HTMLElement.prototype.scrollTo)dom.window.HTMLElement.prototype.scrollTo=function(options){this.scrollTop=typeof options==='object'?(options.top??0):0;};
  // rc-trigger / rc-resize-observer require these observers; jsdom ships neither. They are used
  // both with and without `new`, so the shim accepts either call style.
  const observer=function(){const self=this instanceof observer?this:Object.create(observer.prototype);self.observe=()=>{};self.unobserve=()=>{};self.disconnect=()=>{};self.takeRecords=()=>[];return self;};
  if(!globalThis.ResizeObserver){globalThis.ResizeObserver=observer;dom.window.ResizeObserver=observer;}
  if(!globalThis.IntersectionObserver){globalThis.IntersectionObserver=observer;dom.window.IntersectionObserver=observer;}
  // @rc-component/overflow posts state updates through a fresh MessageChannel every effect flush and
  // never closes it. Node counts MessagePort as a live handle, so those channels keep the test
  // process alive forever (and pile up); a browser drops them with the response. A timer-backed
  // channel keeps the asynchronous delivery semantics without holding the event loop open.
  const Channel=function(){const self=this instanceof Channel?this:Object.create(Channel.prototype);self.port1={onmessage:null,addEventListener(){},removeEventListener(){},start(){},close(){}};self.port2={postMessage(message){setTimeout(()=>self.port1.onmessage?.({data:message}),0);},start(){},close(){},addEventListener(){}};return self;};
  globalThis.MessageChannel=Channel;dom.window.MessageChannel=Channel;
}
