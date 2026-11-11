import sandboxSource from './dashboardSandbox.js?raw';
import placementSource from './dashboardPlacement.js?raw';
import {decodeDashboardPackage,dashboardMime,type DashboardPackage} from '../../shared/dashboard-package.mjs';
import {validDashboardRegion,type DashboardBinding,type DashboardRegion} from '../domain/dashboard';

const VIRTUAL_ROOT='https://dashboard.invalid/';
const POLICY="default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline' blob:; img-src blob: data:; font-src blob: data:; media-src blob: data:; connect-src blob:; frame-src about: blob:; worker-src 'none'; object-src 'none'; base-uri https://dashboard.invalid; form-action 'none'; navigate-to 'none'";
interface PreparedDashboard {
  entry:string;
  resources:Record<string,{mime:string;base64?:string;text?:string}>;
  documents:Record<string,string>;
  modules:Record<string,string>;
  marker:string;
}
interface JsToken {start:number;end:number;value:string;string?:boolean}

function jsonForHtml(value:unknown):string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,char=>`\\u${char.charCodeAt(0).toString(16).padStart(4,'0')}`);
}
function escapeHtml(value:string):string {
  return value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
}
function toBase64(bytes:Uint8Array):string {
  let value='';
  for(let offset=0;offset<bytes.length;offset+=0x8000)value+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));
  return btoa(value);
}

/** Tokenize only the JavaScript syntax needed for module references, never strings/comments. */
function jsTokens(source:string):JsToken[] {
  const tokens:JsToken[]=[];
  let position=0;
  while(position<source.length) {
    const start=position,char=source[position];
    if(/\s/.test(char)){position++;continue;}
    if(source.startsWith('//',position)){const end=source.indexOf('\n',position);position=end<0?source.length:end;continue;}
    if(source.startsWith('/*',position)){const end=source.indexOf('*/',position+2);if(end<0)throw new Error('JavaScript 注释未结束');position=end+2;continue;}
    if(char==='"'||char==="'") {
      position++;
      let value='';
      while(position<source.length&&source[position]!==char) {
        if(source[position]==='\\') {
          position++;
          const escaped=source[position++];
          if(escaped==='u'||escaped==='x') {
            const size=escaped==='u'?4:2,hex=source.slice(position,position+size);
            if(!new RegExp(`^[a-fA-F0-9]{${size}}$`).test(hex))throw new Error('资源引用包含不支持的 JavaScript 转义');
            value+=String.fromCharCode(parseInt(hex,16));position+=size;
          } else value+=({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v','\n':'','\r':''} as Record<string,string>)[escaped]??escaped;
        } else value+=source[position++];
      }
      if(position>=source.length)throw new Error('JavaScript 字符串未结束');
      tokens.push({start,end:++position,value,string:true});continue;
    }
    if(char==='`') {
      // Expressions inside template literals can themselves import resources. Reject rather than silently leak a network fallback.
      position++;
      while(position<source.length) {
        if(source[position]==='\\'){position+=2;continue;}
        if(source[position]==='`'){position++;break;}
        if(source.startsWith('${',position)) {
          const close=source.indexOf('`',position);
          const expression=source.slice(position,close<0?source.length:close);
          if(/\bimport\s*\(|\bimport\s*\.\s*meta/.test(expression))throw new Error('模板字符串中的模块导入不受支持，请将导入移至普通表达式');
        }
        position++;
      }
      tokens.push({start,end:position,value:'<template>'});continue;
    }
    if(/[\w$]/.test(char)) {position++;while(position<source.length&&/[\w$]/.test(source[position]))position++;tokens.push({start,end:position,value:source.slice(start,position)});continue;}
    // A regexp cannot contain an actual import declaration; keep its contents opaque.
    if(char==='/'&&(!tokens.length||/^(?:[=(,:;!&|?{}\[]|return|case|throw|=>)$/.test(tokens[tokens.length-1].value))) {
      position++;let bracket=false;
      while(position<source.length) {const next=source[position++];if(next==='\\'){position++;continue;}if(next==='[')bracket=true;if(next===']')bracket=false;if(next==='/'&&!bracket)break;}
      while(/[a-z]/i.test(source[position]??'')&&position<source.length)position++;
      tokens.push({start,end:position,value:'<regexp>'});continue;
    }
    tokens.push({start,end:++position,value:char});
  }
  return tokens;
}

function prepareDashboard(pack:DashboardPackage):PreparedDashboard {
  const files=decodeDashboardPackage(pack);
  const result:PreparedDashboard={entry:pack.entry,resources:Object.create(null),documents:Object.create(null),modules:Object.create(null),marker:`__DASHBOARD_${crypto.randomUUID().replace(/-/g,'')}_`};
  const decoder=new TextDecoder('utf-8',{fatal:true});
  const reading=new Set<string>();
  function resolve(reference:string,base:string):{path:string;url:string;hash:string}|null {
    const value=reference.trim();
    if(!value||value.startsWith('#')||/^data:/i.test(value))return null;
    if(value.includes('\\'))throw new Error(`不支持的资源路径：${reference}（${base}）`);
    const url=new URL(value,new URL(base,VIRTUAL_ROOT));
    if(url.origin!==new URL(VIRTUAL_ROOT).origin||url.username||url.password)throw new Error(`看板不能访问外部资源：${reference}（${base}）`);
    let path:string;
    try{path=decodeURIComponent(url.pathname.slice(1));}catch{throw new Error(`无效的资源路径：${reference}（${base}）`);}
    if(!Object.prototype.hasOwnProperty.call(files,path))throw new Error(`看板缺少资源：${path}（引用自 ${base}）`);
    return {path,url:url.href,hash:url.hash};
  }
  function asset(reference:string,base:string):string {
    if(/^data:/i.test(reference.trim()))return reference;
    const target=resolve(reference,base);
    if(!target)return reference;
    compileResource(target.path);
    return `${result.marker}${encodeURIComponent(target.path)}__${target.hash}`;
  }
  function css(source:string,path:string):string {
    return source.replace(/@import\s+(?:url\(\s*)?(["'])([^"']+)\1\s*\)?/gi,(_all,quote:string,url:string)=>`@import url(${quote}${asset(url,path)}${quote})`)
      .replace(/url\(\s*(?:(["'])(.*?)\1|([^\s)'"\(]+))\s*\)/gi,(_all,_quote:string,quoted:string,bare:string)=>{
        const value=quoted??bare;
        if(value.startsWith(result.marker)||value.startsWith('#'))return `url(${JSON.stringify(value)})`;
        return `url(${JSON.stringify(asset(value,path))})`;
      });
  }
  function moduleReference(reference:string,path:string):string {
    if(!reference.startsWith('.')&&!reference.startsWith('/')&&!reference.startsWith(VIRTUAL_ROOT))throw new Error(`不支持裸模块或外部模块：${reference}（${path}）；请使用包内相对路径`);
    const target=resolve(reference,path);
    if(!target)throw new Error(`不支持的模块引用：${reference}（${path}）`);
    result.modules[target.url]=target.path;
    if(!/\.(?:m?js|cjs)$/i.test(target.path))throw new Error(`源码已保留，但模块 ${target.path} 不能直接在浏览器运行（引用自 ${path}）。请本地构建并选择 dist/build 中的 HTML 入口。`);
    compileResource(target.path);
    return target.url;
  }
  function javascript(source:string,path:string):string {
    const tokens=jsTokens(source),edits:{start:number;end:number;value:string}[]=[];
    for(let index=0;index<tokens.length;index++) {
      const current=tokens[index],next=tokens[index+1];
      if(current.string||!next||tokens[index-1]?.value==='.')continue;
      if(current.value==='import'&&next.value==='.'&&tokens[index+2]?.value==='meta'&&tokens[index+3]?.value==='.'&&tokens[index+4]?.value==='url') {
        edits.push({start:current.start,end:tokens[index+4].end,value:JSON.stringify(new URL(path,VIRTUAL_ROOT).href)});index+=4;continue;
      }
      if(current.value==='import'&&next.value==='(') {
        let depth=1,end=index+2;
        for(;end<tokens.length;end++){if(tokens[end].value==='(')depth++;else if(tokens[end].value===')'&&!--depth)break;}
        if(end===tokens.length)throw new Error(`动态模块导入未结束：${path}`);
        const argument=tokens[index+2];
        if(argument?.string&&tokens[index+3]?.value===')')moduleReference(argument.value,path);
        edits.push({start:current.start,end:next.end,value:`import(globalThis.__dashboardLocal.module(${JSON.stringify(path)},`});
        edits.push({start:tokens[end].start,end:tokens[end].start,value:')'});continue;
      }
      if(current.value==='import'||current.value==='export') {
        if(current.value==='import'&&next.string)edits.push({start:next.start,end:next.end,value:JSON.stringify(moduleReference(next.value,path))});
        else for(let cursor=index+1;cursor<tokens.length;cursor++) {
          if(tokens[cursor].value===';')break;
          if(tokens[cursor].value==='from'&&tokens[cursor+1]?.string) {
            const specifier=tokens[cursor+1];edits.push({start:specifier.start,end:specifier.end,value:JSON.stringify(moduleReference(specifier.value,path))});break;
          }
          if(tokens[cursor].value==='import'||tokens[cursor].value==='export')break;
        }
      }
    }
    edits.sort((a,b)=>b.start-a.start||b.end-a.end);
    for(const edit of edits)source=source.slice(0,edit.start)+edit.value+source.slice(edit.end);
    return source;
  }
  function compileResource(path:string):void {
    if(Object.prototype.hasOwnProperty.call(result.resources,path)){
      if(reading.has(path))throw new Error(`不支持循环 CSS 引用：${path}`);
      return;
    }
    const mime=dashboardMime(path);
    result.resources[path]={mime};
    if(/\.(?:m?js|cjs)$/i.test(path)) {
      // Register before descending so cyclic module graphs remain supported by the import map.
      result.resources[path].text=javascript(decoder.decode(files[path]),path);
      result.modules[new URL(path,VIRTUAL_ROOT).href]=path;
    } else if(/\.css$/i.test(path)) {
      reading.add(path);result.resources[path].text=css(decoder.decode(files[path]),path);reading.delete(path);
    } else result.resources[path].base64=toBase64(files[path]);
  }
  function html(path:string):void {
    if(Object.prototype.hasOwnProperty.call(result.documents,path))return;
    result.documents[path]='';
    const document=new DOMParser().parseFromString(decoder.decode(files[path]),'text/html');
    document.querySelectorAll('iframe').forEach(element=>{
      if(!element.matches('[data-scenivo-scene],[data-scene-slot],.lg-scene__frame,.scene')&&!element.closest('[data-scenivo-scene],[data-scene-slot],.lg-scene,.scene,.wm-warehouse-viewport,.warehouse-map'))throw new Error(`看板不支持嵌套页面或插件：iframe（${path}）`);
      // Keep the original scene box and CSS hooks, never execute the template's nested viewer.
      const placeholder=document.createElement('div');
      for(const attribute of element.attributes)if(!['src','srcdoc','sandbox','onload','onerror'].includes(attribute.name.toLowerCase()))placeholder.setAttribute(attribute.name,attribute.value);
      placeholder.setAttribute('data-dashboard-scene-visual','');
      element.replaceWith(placeholder);
    });
    document.querySelectorAll('base,meta[http-equiv],object,embed,portal').forEach(element=>{
      if(element.matches('object,embed,portal'))throw new Error(`看板不支持嵌套页面或插件：${element.tagName.toLowerCase()}（${path}）`);
      element.remove();
    });
    for(const element of document.querySelectorAll('*')) {
      if(element.hasAttribute('style'))element.setAttribute('style',css(element.getAttribute('style')!,path));
      if(element.tagName==='STYLE')element.textContent=css(element.textContent??'',path);
      if(element.tagName==='SCRIPT') {
        const source=element.getAttribute('src');
        if(source){const target=resolve(source,path);if(target&&!/\.(?:m?js|cjs)$/i.test(target.path))throw new Error(`源码已保留，但脚本 ${target.path} 需要构建，不能直接预览。请选择构建后的 dist/build HTML 入口。`);}
        const type=(element.getAttribute('type')??'').trim().toLowerCase();
        if(type==='importmap')throw new Error(`看板不支持自定义 importmap；请使用包内相对模块路径（${path}）`);
        if(type&&type!=='module'&&!/^(?:text|application)\/(?:java|ecma)script$/.test(type))continue;
        element.removeAttribute('integrity');element.removeAttribute('crossorigin');
        if(!element.hasAttribute('src'))element.textContent=javascript(element.textContent??'',path);
      }
      if(element.tagName==='LINK') {
        const rel=(element.getAttribute('rel')??'').toLowerCase().split(/\s+/);
        if(!rel.some(value=>['stylesheet','icon','preload','modulepreload'].includes(value))){element.remove();continue;}
        element.removeAttribute('integrity');element.removeAttribute('crossorigin');
      }
      for(const attribute of ['src','href','poster','background','xlink:href']) {
        const value=element.getAttribute(attribute);
        if(value===null)continue;
        if((element.tagName==='A'||element.tagName==='AREA')&&attribute==='href') {
          if(!value||value.startsWith('#'))continue;
          const target=resolve(value,path);
          if(target&&/\.html?$/i.test(target.path)){html(target.path);element.setAttribute('data-dashboard-page',target.path+target.hash);element.setAttribute('href','#');}
          else if(target)element.setAttribute(attribute,asset(value,path));
          element.removeAttribute('target');element.removeAttribute('ping');
        } else element.setAttribute(attribute,asset(value,path));
      }
      for(const attribute of ['srcset','imagesrcset']) {
        const value=element.getAttribute(attribute);
        if(value){if(/data:/i.test(value))throw new Error(`srcset 不支持 data URL，请使用包内图片（${path}）`);element.setAttribute(attribute,value.split(',').map(part=>{const match=part.trim().match(/^(\S+)(.*)$/);return match?asset(match[1],path)+match[2]:'';}).join(', '));}
      }
      for(const attribute of ['action','formaction','ping'])element.removeAttribute(attribute);
    }
    result.documents[path]='<!doctype html>'+document.documentElement.outerHTML;
  }
  html(pack.entry);
  // Preserve ancillary source/configuration as inert bytes; only the entry's dependency graph is compiled.
  for(const path of Object.keys(files))if(!Object.prototype.hasOwnProperty.call(result.resources,path))result.resources[path]={mime:dashboardMime(path),base64:toBase64(files[path])};
  return result;
}

interface DashboardComposition {binding:DashboardBinding;sceneHtml:string}
interface PlacementInspection {nonce:string}

function previewHtml(prepared:PreparedDashboard,composition?:DashboardComposition,inspection?:PlacementInspection):string {
  if(composition?.binding.region!==undefined&&!validDashboardRegion(composition.binding.region))throw new Error('三维区域必须位于看板 0–100% 范围内，宽高至少为 5%');
  const childNonce=inspection?crypto.randomUUID():undefined;
  const script=`<script>${placementSource}\n${sandboxSource}\nmountDashboard(${jsonForHtml(prepared)},${jsonForHtml(POLICY)},${jsonForHtml({sceneHtml:composition?.binding.mode==='overlay'?undefined:composition?.sceneHtml,region:composition?.binding.region,inspect:!!inspection,nonce:childNonce})});</script>`;
  let template=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(POLICY)}"><title>看板预览</title></head><body>${script}</body></html>`;
  if(composition?.binding.mode==='overlay') {
    const {binding,sceneHtml}=composition;
    const {x,y,width,height}=binding.slot;
    if(!validDashboardRegion(binding.slot))throw new Error('看板叠加区域必须位于 0–100% 范围内，宽高至少为 5%');
    // The panel has the same logical board viewport, fitted once at its fixed slot size.
    // Only the trusted outer viewport below responds to browser/modal resizing.
    const scale=Math.min(width/100,height/100);
    const left=(1920*width/100-1920*scale)/2,top=(1080*height/100-1080*scale)/2;
    template=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(POLICY)}"><title>${escapeHtml(binding.name||'看板场景')}</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#071329}iframe{position:absolute;inset:0;width:100%;height:100%;border:0;display:block;background:transparent}#dashboard-slot{position:absolute;left:${x}%;top:${y}%;width:${width}%;height:${height}%;overflow:hidden;z-index:1}#dashboard{inset:auto;left:${left}px;top:${top}px;width:1920px;height:1080px;transform:scale(${scale});transform-origin:0 0}</style></head><body><iframe id="scene" title="三维场景" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe><div id="dashboard-slot"><iframe id="dashboard" title="叠加看板" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe></div><script>document.getElementById('scene').srcdoc=${jsonForHtml(sceneHtml)};document.getElementById('dashboard').srcdoc=${jsonForHtml(template)};</script></body></html>`;
  }
  // A bounded one-way placement result is the only cross-frame API.
  const bridge=inspection?`const send=parent.postMessage.bind(parent);function validRegion(r){return r&&typeof r==='object'&&[r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.x>=0&&r.y>=0&&r.width>=5&&r.height>=5&&r.x+r.width<=100&&r.y+r.height<=100;}addEventListener('message',function receive(event){if(event.source!==child.contentWindow||event.origin!=='null')return;const data=event.data;if(!data||data.kind!=='scenivo-placement'||data.nonce!==${jsonForHtml(childNonce)}||typeof data.ok!=='boolean')return;const text=data.ok?data.description:data.error;if(typeof text!=='string'||text.length>1000||data.ok&&!validRegion(data.region))return;removeEventListener('message',receive);send({kind:'scenivo-placement',nonce:${jsonForHtml(inspection.nonce)},ok:data.ok,...(data.ok?{description:text,region:{x:data.region.x,y:data.region.y,width:data.region.width,height:data.region.height}}:{error:text})},'*');});`:'';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(POLICY)}"><title>${escapeHtml(composition?.binding.name||'看板预览')}</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#071329}#template{position:absolute;left:0;top:0;width:1920px;height:1080px;border:0;display:block;transform-origin:0 0;background:#071329}</style></head><body><iframe id="template" title="隔离集成看板" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe><script>const child=document.getElementById('template');function fit(){const scale=Math.min(innerWidth/1920,innerHeight/1080);child.style.left=(innerWidth-1920*scale)/2+'px';child.style.top=(innerHeight-1080*scale)/2+'px';child.style.transform='scale('+scale+')';}fit();addEventListener('resize',fit);${bridge}child.srcdoc=${jsonForHtml(template)};</script></body></html>`;
}

export async function buildDashboardPreview(pack:DashboardPackage,composition?:DashboardComposition):Promise<{html:string}> {
  return {html:previewHtml(prepareDashboard(pack),composition)};
}

/** Measure the actual rendered package in an opaque frame before mutating a model. */
export async function inspectDashboardPlacement(pack:DashboardPackage,signal?:AbortSignal):Promise<{description:string;region:DashboardRegion}> {
  signal?.throwIfAborted();
  const nonce=crypto.randomUUID();
  const html=previewHtml(prepareDashboard(pack),undefined,{nonce});
  const {promise,resolve,reject}=Promise.withResolvers<{description:string;region:DashboardRegion}>();
  const iframe=document.createElement('iframe');
  iframe.setAttribute('sandbox','allow-scripts');
  iframe.setAttribute('referrerpolicy','no-referrer');
  iframe.setAttribute('aria-hidden','true');
  // Keep the logical probe onscreen: Chromium throttles offscreen paint callbacks.
  iframe.style.cssText='position:fixed;left:0;top:0;width:1920px;height:1080px;border:0;pointer-events:none;opacity:0.001;z-index:2147483646';
  const finish=(error?:Error,result?:{description:string;region:DashboardRegion})=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);window.removeEventListener('message',receive);iframe.remove();if(error)reject(error);else resolve(result!);};
  const abort=()=>finish(new DOMException('已取消接入','AbortError'));
  const receive=(event:MessageEvent)=>{
    if(event.source!==iframe.contentWindow||event.origin!=='null')return;
    const data:unknown=event.data;
    if(!data||typeof data!=='object')return;
    const result=data as Record<string,unknown>;
    if(result.kind!=='scenivo-placement'||result.nonce!==nonce||typeof result.ok!=='boolean')return;
    const text=result.ok?result.description:result.error;
    if(typeof text!=='string'||text.length>1000||result.ok&&!validDashboardRegion(result.region))return;
    if(result.ok) {
      const {x,y,width,height}=result.region as DashboardRegion;
      finish(undefined,{description:text,region:{x,y,width,height}});
    } else finish(new Error(text));
  };
  const timer=setTimeout(()=>finish(new Error('看板场景区域检测超时，未接入模型；请检查模板能否完整离线渲染')),18000);
  window.addEventListener('message',receive);
  signal?.addEventListener('abort',abort,{once:true});
  iframe.srcdoc=html;
  document.body.append(iframe);
  return promise;
}

export async function buildDashboardExport(pack:DashboardPackage,binding:DashboardBinding,sceneHtml:string):Promise<string> {
  return previewHtml(prepareDashboard(pack),{binding,sceneHtml});
}
