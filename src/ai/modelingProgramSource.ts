/** Source inspection and literal editing only: none of these helpers execute a program.
 * Lines are one-based/inclusive; character offsets are zero-based UTF-16/exclusive.
 */
export interface SourceReadOptions {
 startLine?:number;
 endLine?:number;
 startChar?:number;
 endChar?:number;
 query?:string;
}
export interface SourceMetadata {version:string;chars:number;lineCount:number}
export interface SourceDeclaration {name:string;kind:'function'|'class'|'variable';line:number;startChar:number}
export interface SourceParameter {name:string;line:number;value?:string}
export interface SourceWindow {startLine:number;endLine:number;startChar:number;endChar:number;text:string}
export interface SourceMatch extends SourceWindow {matchStartChar:number;matchEndChar:number}
/** nextChar is the exact continuation cursor; nextLine alone may repeat a partially returned long line. */
export type SourceReadResult=SourceMetadata&(
 | {mode:'summary';directory:SourceDeclaration[];declarationCount:number;directoryTruncated:boolean;parameterHeader:SourceParameter[];hint:string}
 | {mode:'lines'|'characters';window:SourceWindow;nextLine?:number;nextChar?:number}
 | {mode:'search';query:string;matches:SourceMatch[];nextLine?:number;nextChar?:number}
);
export interface SourcePatch {find:string;replace:string}
export interface SourceEditOptions {expectedVersion:string;patches:SourcePatch[]}
/** Keep `source` internal: tool responses should return metadata, never this whole object. */
export interface SourceEditResult extends SourceMetadata {source:string;patchCount:number}

const MAX_CHARS=12000,MAX_LINES=120,MAX_SOURCE=80000,MAX_PATCHES=8,MAX_MATCHES=8;
const own=(value:object,key:string)=>Object.prototype.hasOwnProperty.call(value,key);
function record(value:unknown,allowed:readonly string[],label:string):asserts value is Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null))throw Error(label+' must be a plain object');
 if(Reflect.ownKeys(value).some(key=>typeof key!=='string'||!allowed.includes(key)))throw Error(label+' contains an unsupported or unsafe key');
 if(Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor=>!('value' in descriptor)))throw Error(label+' must not contain accessors');
}
function integer(value:unknown,label:string,min:number,max:number):number{
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw Error(`${label} 必须是 ${min} 到 ${max} 之间的安全整数`);
 return value;
}
function offsets(source:string):number[]{
 const result=[0];for(let i=0;i<source.length;i++)if(source.charCodeAt(i)===10)result.push(i+1);return result;
}
function lineAt(lines:number[],position:number):number{
 let lo=0,hi=lines.length;while(lo+1<hi){const mid=(lo+hi)>>>1;if(lines[mid]<=position)lo=mid;else hi=mid;}return lo+1;
}
/** Two independent 32-bit accumulators, deterministic across browsers and runtimes. */
function version(source:string):string{
 let a=0x811c9dc5,b=0x9e3779b9;
 for(let i=0;i<source.length;i++){const code=source.charCodeAt(i);a=Math.imul(a^code,0x01000193);b=Math.imul(b^code,0x5bd1e995);b^=b>>>13;}
 return `v1-${source.length}-${(a>>>0).toString(16).padStart(8,'0')}${(b>>>0).toString(16).padStart(8,'0')}`;
}
function metadata(source:string,lines:number[]):SourceMetadata{return {version:version(source),chars:source.length,lineCount:lines.length};}
function startCursor(value:unknown,label:'startLine'|'startChar',source:string,lines:number[]):number{
 const start=integer(value,label,label==='startLine'?1:0,Number.MAX_SAFE_INTEGER),max=label==='startLine'?lines.length:source.length;
 if(start>max)throw Error(`${label}=${start} 超出源码范围；实际 lineCount=${lines.length}，chars=${source.length}。有效游标：startLine 为 1..${lines.length}，startChar 为 0..${source.length}（UTF-16）；请按此范围重试，或先不传选择器读取摘要。`);
 return start;
}
function boundedEnd(source:string,lines:number[],start:number,requestedEnd:number):number{
 const first=lineAt(lines,start);
 return Math.min(requestedEnd,source.length,start+MAX_CHARS,lines[first-1+MAX_LINES]??source.length);
}
function continuation(source:string,lines:number[],end:number):{nextLine?:number;nextChar?:number}{
 return end<source.length?{nextChar:end,nextLine:lineAt(lines,end)}:{};
}
function window(source:string,lines:number[],start:number,end:number):SourceWindow{
 return {startLine:lineAt(lines,start),endLine:lineAt(lines,Math.max(start,end-1)),startChar:start,endChar:end,text:source.slice(start,end)};
}
function summary(source:string,lines:number[]):Extract<SourceReadResult,{mode:'summary'}>{
 const masked=source.replace(/\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\r\n]*|'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|`(?:\\[\s\S]|[^`\\])*`/g,text=>text.replace(/[^\r\n]/g,' ')),directory:SourceDeclaration[]=[],parameterHeader:SourceParameter[]=[];
 const declarations=/\b(function(?:\s+\*?\s*|\s*\*\s*)|class\s+|(?:const|let|var)\s+)([A-Za-z_$][\w$]*)/g;
 // Navigation only: ignore strings/comments; this index is not a JavaScript correctness verdict.
 let count=0,match:RegExpExecArray|null;
 while((match=declarations.exec(masked))){
  const name=match[2],start=match.index,line=lineAt(lines,start),after=masked.slice(declarations.lastIndex,declarations.lastIndex+200);
  const kind=match[1].startsWith('function')||/^\s*=\s*(?:async\s*)?(?:function\b|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/.test(after)?'function':match[1].startsWith('class')?'class':'variable';
  count++;
  if(directory.length<40)directory.push({name:name.slice(0,80),kind,line,startChar:start});
  if(kind==='variable'&&parameterHeader.length<12&&start<4000){
   const initializer=/^\s*=\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true\b|false\b|null\b|'(?:\\.|[^'\\\r\n]){0,80}'|"(?:\\.|[^"\\\r\n]){0,80}")(?=\s*[,;\r\n]|\s*$)/.exec(source.slice(declarations.lastIndex,declarations.lastIndex+160));
   parameterHeader.push({name:name.slice(0,80),line,...(initializer?{value:initializer[1]}:{})});
  }
 }
 return {...metadata(source,lines),mode:'summary',directory,declarationCount:count,directoryTruncated:count>directory.length,parameterHeader,hint:`仅为导航索引，不执行源码。有效范围：startLine=1..${lines.length}（含 endLine），startChar=0..${source.length}（UTF-16，endChar 不含）；示例 ${JSON.stringify({startLine:1,endLine:Math.min(lines.length,20)})} 或 ${JSON.stringify({startChar:0,endChar:Math.min(source.length,1000)})}。结束位置超出 EOF 会截到末尾；每页最多 120 行 / 12000 字符，长行可分段。优先用 nextChar 作为下次 startChar，避免长行续读丢失；仅整行翻页可用 nextLine。query 为字面文本，可配 startLine 或 startChar 续查，不能配 endLine/endChar；例如 {"query":"const"}。行与字符选择器不能混用。部件和 ID 请用 read_scene；保存的源码不包含后续手动场景编辑。`};
}

export function readSource(source:string,options:SourceReadOptions={}):SourceReadResult{
 if(typeof source!=='string')throw Error('source must be a string');
 record(options,['startLine','endLine','startChar','endChar','query'],'read options');
 const lines=offsets(source),hasLine=own(options,'startLine')||own(options,'endLine'),hasChar=own(options,'startChar')||own(options,'endChar');
 if(hasLine&&hasChar)throw Error('不能混用行选择器 startLine/endLine 与字符选择器 startChar/endChar；请选择一种范围或游标');
 if(own(options,'query')){
  if(typeof options.query!=='string'||!options.query.length||options.query.length>1000||options.query.split('\n').length>116)throw Error('query 必须是非空字面文本，最多 1000 字符和 116 行');
  if(own(options,'endLine')||own(options,'endChar'))throw Error('query 搜索只能配 startLine 或 startChar 续查，不能配 endLine/endChar 结束选择器');
  const start=hasChar?startCursor(options.startChar,'startChar',source,lines):hasLine?lines[startCursor(options.startLine,'startLine',source,lines)-1]:0;
  const matches:SourceMatch[]=[];let cursor=start,index=source.indexOf(options.query,cursor);
  while(index!==-1&&matches.length<MAX_MATCHES){
   const end=index+options.query.length,first=lineAt(lines,index),last=lineAt(lines,Math.max(index,end-1));
   const a=Math.max(lines[Math.max(0,first-3)],index-240),b=Math.min(lines[Math.min(lines.length,last+2)]??source.length,end+240);
   matches.push({...window(source,lines,a,b),matchStartChar:index,matchEndChar:end});
   cursor=index+1;index=source.indexOf(options.query,cursor);
  }
  return {...metadata(source,lines),mode:'search',query:options.query,matches,...(index!==-1?{nextLine:lineAt(lines,index),nextChar:index}:{})};
 }
 if(hasChar){
  const start=startCursor(options.startChar,'startChar',source,lines),requestedEnd=own(options,'endChar')?integer(options.endChar,'endChar',start,Number.MAX_SAFE_INTEGER):source.length;
  const end=boundedEnd(source,lines,start,requestedEnd);
  return {...metadata(source,lines),mode:'characters',window:window(source,lines,start,end),...continuation(source,lines,end)};
 }
 if(hasLine){
  const start=startCursor(options.startLine,'startLine',source,lines),requestedEnd=own(options,'endLine')?integer(options.endLine,'endLine',start,Number.MAX_SAFE_INTEGER):lines.length;
  const last=Math.min(requestedEnd,lines.length,start+MAX_LINES-1),a=lines[start-1];let end=start-1,b=a;
  while(end<last){const next=lines[end+1]??source.length;if(next-a>MAX_CHARS)break;b=next;end++;}
  // Preserve complete lines where possible; a single oversized line must still make progress.
  if(end<start){b=boundedEnd(source,lines,a,lines[start]??source.length);end=lineAt(lines,Math.max(a,b-1));}
  return {...metadata(source,lines),mode:'lines',window:{...window(source,lines,a,b),endLine:end},...continuation(source,lines,b)};
 }
 return summary(source,lines);
}

/** Resolve all patches against the same original source before applying any changes. */
export function editSource(source:string,options:SourceEditOptions):SourceEditResult{
 if(typeof source!=='string')throw Error('source must be a string');
 record(options,['expectedVersion','patches'],'edit options');
 if(!own(options,'expectedVersion')||!own(options,'patches'))throw Error('edit options requires expectedVersion and patches');
 if(typeof options.expectedVersion!=='string'||options.expectedVersion!==version(source))throw Error('Stale expectedVersion: read the current source before editing');
 if(!Array.isArray(options.patches)||Object.getPrototypeOf(options.patches)!==Array.prototype||options.patches.length<1||options.patches.length>MAX_PATCHES)throw Error('patches must contain between 1 and 8 literal patches');
 if(Reflect.ownKeys(options.patches).some(key=>typeof key!=='string'||(key!=='length'&&!/^(?:0|[1-9]\d*)$/.test(key))))throw Error('patches contains an unsupported or unsafe key');
 if(Object.values(Object.getOwnPropertyDescriptors(options.patches)).some(descriptor=>!('value' in descriptor)))throw Error('patches must not contain accessors');
 const resolved:{start:number;end:number;replace:string}[]=[];let size=source.length;
 for(let i=0;i<options.patches.length;i++){
  if(!own(options.patches,String(i)))throw Error('patches must not contain empty entries');
  const patch=options.patches[i];record(patch,['find','replace'],'patch');
  if(!own(patch,'find')||!own(patch,'replace'))throw Error('Each patch requires find and replace');
  if(typeof patch.find!=='string'||!patch.find.length||typeof patch.replace!=='string')throw Error('Each patch requires nonempty literal find and string replace');
  if(patch.find===patch.replace)throw Error('Patch makes no change');
  const start=source.indexOf(patch.find);
  if(start===-1)throw Error(`Patch ${i+1} find did not match the source`);
  if(source.indexOf(patch.find,start+1)!==-1)throw Error(`Patch ${i+1} find is ambiguous; include unique surrounding text`);
  resolved.push({start,end:start+patch.find.length,replace:patch.replace});size+=patch.replace.length-patch.find.length;
 }
 resolved.sort((a,b)=>a.start-b.start);
 for(let i=1;i<resolved.length;i++)if(resolved[i].start<resolved[i-1].end)throw Error('Patches overlap in the original source');
 if(size>MAX_SOURCE)throw Error('Modified source exceeds 80000 chars');
 let cursor=0;const chunks:string[]=[];
 for(const patch of resolved){chunks.push(source.slice(cursor,patch.start),patch.replace);cursor=patch.end;}
 chunks.push(source.slice(cursor));const modified=chunks.join('');
 if(modified===source)throw Error('Patches make no change to the resulting source');
 return {...metadata(modified,offsets(modified)),source:modified,patchCount:resolved.length};
}
