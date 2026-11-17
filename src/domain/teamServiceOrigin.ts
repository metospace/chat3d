const ORIGIN_ERROR='请输入 HTTPS 服务根地址（本机或内网地址可用 HTTP）';
function privateHTTPHost(host:string):boolean {
 if(host==='localhost'||host==='[::1]')return true;
 const octets=host.split('.').map(Number);
 return octets.length===4&&octets.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&(octets[0]===127||octets[0]===10||octets[0]===172&&octets[1]>=16&&octets[1]<=31||octets[0]===192&&octets[1]===168||octets[0]===100&&octets[1]>=64&&octets[1]<=127);
}
/** Team services accept HTTPS anywhere, or HTTP on explicit loopback/private IP ranges. */
export function teamServiceOrigin(value:string):string {
 const root=/^https?:\/\/[^/?#\\@\s]+\/?$/i;
 if(value.trim()!==value||!root.test(value))throw Error(ORIGIN_ERROR);
 const url=new URL(value);
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||(url.protocol!=='https:'&&!(url.protocol==='http:'&&privateHTTPHost(url.hostname))))throw Error(ORIGIN_ERROR);
 return url.origin;
}
