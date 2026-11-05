/** Clone tool schemas into the JSON Schema subset accepted by Codex providers. */
export function sanitizeToolParametersForProvider<T>(parameters:T):T {
  if(Array.isArray(parameters))return parameters.map(value=>sanitizeToolParametersForProvider(value)) as T;
  if(parameters===null||typeof parameters!=='object')return parameters;
  const result:Record<string,unknown>={};
  for(const key of Reflect.ownKeys(parameters)){
    if(typeof key!=='string'||key.startsWith('~')||key==='oneOf'||key==='uniqueItems')continue;
    Object.defineProperty(result,key,{value:sanitizeToolParametersForProvider(Reflect.get(parameters,key)),enumerable:true,writable:true,configurable:true});
  }
  if(result.pattern==='\\S'){
    // Codex cannot determine emptiness for this search regex combined with minLength.
    delete result.pattern;
    if(typeof result.minLength!=='number'||!(result.minLength>=1))result.minLength=1;
  }
  if(Array.isArray(result.items)){
    // Replace draft-07 tuple validation with draft 2020-12 keywords.
    const prefixItems=result.items;
    result.prefixItems=prefixItems;
    result.items=false;
    result.maxItems=typeof result.maxItems==='number'?Math.min(result.maxItems,prefixItems.length):prefixItems.length;
    delete result.additionalItems;
  }
  if(Object.prototype.hasOwnProperty.call(parameters,'oneOf')){
    const alternatives=sanitizeToolParametersForProvider(Reflect.get(parameters,'oneOf'));
    if(Object.prototype.hasOwnProperty.call(parameters,'anyOf')){
      // Both unions constrained the original schema: retain their conjunction.
      const conjunction={anyOf:alternatives};
      if(Array.isArray(result.allOf))result.allOf.push(conjunction);
      else result.allOf=[conjunction];
    }else result.anyOf=alternatives;
  }
  return result as T;
}

/** Tool `.parameters` must be a JSON Schema object root for providers like tokenrouter. */
export function ensureToolParametersObject<T>(parameters:T):T & {type:'object'} {
  const sanitized=sanitizeToolParametersForProvider(parameters) as Record<string,unknown>;
  if(sanitized===null||typeof sanitized!=='object'||Array.isArray(sanitized)){
    return {type:'object',properties:{}} as unknown as T & {type:'object'};
  }
  if(sanitized.type==='object')return sanitized as T & {type:'object'};
  return {...sanitized,type:'object'} as T & {type:'object'};
}
