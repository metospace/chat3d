import {listLibraryCategories,saveLibraryCategory,type LibraryKind,type LibraryCategory} from './libraryCategories';
import {validCategory} from './libraryMetadata';

export function validPublishedCategoryPath(value:unknown):value is string[]{
 return Array.isArray(value)&&value.length<=2&&value.every(label=>validCategory(label)&&!/[\u007f-\u009f]/.test(label)&&!['全部','未分类'].includes(label)&&!/^category-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(label));
}
/** Published labels belong to the fixed version, never interpreted as local category IDs. */
export function publishedCategoryPath(item:{categoryPath?:string[];kind?:string;payload?:unknown}):string[]{
 if(item.categoryPath!==undefined)return validPublishedCategoryPath(item.categoryPath)?[...item.categoryPath]:[];
 const payload=item.payload;
 if(item.kind==='asset'&&payload&&typeof payload==='object'&&'category' in payload&&validPublishedCategoryPath([payload.category]))return [String(payload.category)];
 return [];
}
export function teamCategoryOptions(items:ReadonlyArray<{categoryPath?:string[]}>):Array<{value:string;label:string}>{
 const paths=new Map<string,string[]>();let unclassified=false;
 for(const item of items){const path=publishedCategoryPath(item);if(!path.length)unclassified=true;for(let i=1;i<=path.length;i++){const prefix=path.slice(0,i);paths.set(JSON.stringify(prefix),prefix);}}
 const options=[...paths].sort((a,b)=>a[1].join(' / ').localeCompare(b[1].join(' / '),'zh-CN')).map(([value,path])=>({value,label:path.join(' / ')}));
 if(unclassified)options.push({value:'[]',label:'未分类'});return options;
}
export function teamCategoryMatches(item:{categoryPath?:string[]},filter:string):boolean{
 if(!filter)return true;
 let selected:unknown;try{selected=JSON.parse(filter);}catch{return false;}
 if(!validPublishedCategoryPath(selected))return false;
 const path=publishedCategoryPath(item);return selected.length===0?path.length===0:selected.every((label,i)=>path[i]===label);
}
export async function localPublishedCategoryPath(kind:LibraryKind,value?:string):Promise<string[]>{
 if(!value)return [];
 const categories=await listLibraryCategories([value],kind),category=categories.find(c=>c.value===value);
 if(!category)return [];
 return category.parentValue?[categories.find(c=>c.value===category.parentValue)?.label??category.parentValue,category.label]:[category.label];
}
/** Match only the same label under the same parent and in the same resource kind. */
export async function acquirePublishedCategory(kind:LibraryKind,path:string[]):Promise<string|undefined>{
 if(!validPublishedCategoryPath(path))throw Error('团队分类路径无效');
 let parent:LibraryCategory|undefined;
 for(const label of path){
  let rows=await listLibraryCategories([],kind),category=rows.find(c=>c.label===label&&(c.parentValue??'')===(parent?.value??''));
  if(!category){
   try{category=await saveLibraryCategory(label,undefined,{kind,parentValue:parent?.value});}
   catch(error){rows=await listLibraryCategories([],kind);category=rows.find(c=>c.label===label&&(c.parentValue??'')===(parent?.value??''));if(!category)throw error;}
  }
  parent=category;
 }
 return parent?.value;
}
