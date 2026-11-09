import type {ComponentType} from 'react';
// Built-in module contract. No remote code loading, shell access or credential access.
export interface WorkbenchModule {id:string;title:string;version:number;Viewport:ComponentType<{active?:boolean}>;Objects:ComponentType;Properties:ComponentType;documentFormat:string}
export function createModuleRegistry(){
 const modules=new Map<string,WorkbenchModule>();
 return {register(module:WorkbenchModule){if(modules.has(module.id))throw new Error(`模块重复注册：${module.id}`);modules.set(module.id,module);},get(id:string){const module=modules.get(id);if(!module)throw new Error(`未注册的工作台模块：${id}`);return module;},list(){return [...modules.values()]}};
}
