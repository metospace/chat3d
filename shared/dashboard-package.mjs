const fail=message=>{throw Object.assign(new Error(message),{status:400});};
const mime={html:'text/html',htm:'text/html',js:'text/javascript',mjs:'text/javascript',css:'text/css',json:'application/json',map:'application/json',txt:'text/plain',csv:'text/csv',xml:'application/xml',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',avif:'image/avif',ico:'image/x-icon',bmp:'image/bmp',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',otf:'font/otf',eot:'application/vnd.ms-fontobject',mp4:'video/mp4',webm:'video/webm',mp3:'audio/mpeg',ogg:'audio/ogg',wav:'audio/wav',wasm:'application/wasm',webmanifest:'application/manifest+json'};
export function dashboardMime(path){return mime[path.slice(path.lastIndexOf('.')+1).toLowerCase()]??'application/octet-stream';}
export function dashboardPath(name,directory=false){
 if(typeof name!=='string'||!name||name.length>1024||name!==name.normalize('NFC')||/[\\\u0000-\u001f\u007f-\u009f:%?#]/.test(name)||name.startsWith('/'))fail('看板文件路径无效：'+String(name));
 const value=directory&&name.endsWith('/')?name.slice(0,-1):name;
 if(!value||value.split('/').some(part=>!part||part==='.'||part==='..'||/[. ]$/.test(part)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))fail('看板文件路径无效：'+name);
 return value;
}
/** Runtime resources already passed streaming server validation; never inflate archives in the UI. */
export function decodeDashboardPackage(pack){
 if(!pack||typeof pack!=='object'||!pack.files||typeof pack.files!=='object'||Array.isArray(pack.files))fail('看板资源无效');
 dashboardPath(pack.entry);if(!/\.html?$/i.test(pack.entry)||!Object.hasOwn(pack.files,pack.entry))fail('看板入口无效');
 for(const [path,bytes] of Object.entries(pack.files)){dashboardPath(path);if(!(bytes instanceof Uint8Array))fail('看板资源字节无效');}
 return pack.files;
}
