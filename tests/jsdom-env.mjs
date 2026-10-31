// jsdom keeps DOM constructors on the window only and has no matchMedia. antd (and therefore Ant
// Design X) reads both while mounting, so every test that renders the chat surface installs these
// after creating its JSDOM instance and before importing React DOM.
export function installBrowserGlobals(dom){
  for(const name of Object.getOwnPropertyNames(dom.window)){
    const value=dom.window[name];
    if(/^[A-Z]/.test(name)&&typeof value==='function'&&!Object.prototype.hasOwnProperty.call(globalThis,name))Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
  }
  const mediaQuery=()=>({matches:false,media:'',onchange:null,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent(){return false}});
  const matchMedia=dom.window.matchMedia??mediaQuery;
  globalThis.matchMedia=matchMedia;dom.window.matchMedia=matchMedia;
}
