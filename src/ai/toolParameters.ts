/** Clone tool schemas into the JSON Schema subset accepted by Codex providers. */
export function sanitizeToolParametersForProvider<T>(parameters:T):T {
  if(Array.isArray(parameters))return parameters.map(value=>sanitizeToolParametersForProvider(value)) as T;
  if(parameters===null||typeof parameters!=='object')return parameters;
  const result:Record<PropertyKey,unknown>={};
  for(const key of Reflect.ownKeys(parameters)){
    if(key==='oneOf'||key==='uniqueItems')continue;
    Object.defineProperty(result,key,{value:sanitizeToolParametersForProvider(Reflect.get(parameters,key)),enumerable:true,writable:true,configurable:true});
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
