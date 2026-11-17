const ORIGIN_ERROR='请输入 HTTPS 服务根地址（本机或内网地址可用 HTTP）';
function privateHTTPHost(host:string):boolean {
 if(host==='localhost'||host==='[::1]')return true;
 const octets=host.split('.').map(Number);
 return octets.length===4&&octets.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&(octets[0]===127||octets[0]===10||octets[0]===172&&octets[1]>=16&&octets[1]<=31||octets[0]===192&&octets[1]===168||octets[0]===100&&octets[1]>=64&&octets[1]<=127);
}
/** Team services accept HTTPS anywhere, or HTTP on explicit loopback/private IP ranges. */
export function teamServiceOrigin(value:string):string {
 // Check raw input before URL parsing can normalize away credentials or non-root paths.
 if(typeof value!=='string'||value.trim()!==value||!/^https?:\/\/[^/?#\\@\s]+\/?$/i.test(value))throw Error(ORIGIN_ERROR);
 let url:URL;
 try{url=new URL(value);}catch{throw Error(ORIGIN_ERROR);}
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||(url.protocol!=='https:'&&!(url.protocol==='http:'&&privateHTTPHost(url.hostname))))throw Error(ORIGIN_ERROR);
 return url.origin;
}
