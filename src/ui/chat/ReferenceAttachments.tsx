import {forwardRef,useEffect,useMemo,useRef,type ComponentRef} from 'react';
import {Attachments,FileCard} from '@ant-design/x';
import {Upload} from 'antd';
import {attachmentInfo,isReferenceImage} from '../../domain/referenceAttachments';

/** Keep the project's persisted references and local preprocessing; Upload never sends files. */
export const ReferenceAttachments=forwardRef<ComponentRef<typeof Attachments>,{
 values:string[];disabled?:boolean;onAdd:(files:File[])=>void;onRemove:(index:number)=>void;
}>(function ReferenceAttachments({values,disabled,onAdd,onRemove},ref){
 const root=useRef<HTMLDivElement>(null);
 // X 2.10 renders remove icons as divs. Preserve the library control and add its missing keyboard name.
 useEffect(()=>{
  const nameControls=()=>root.current?.querySelectorAll<HTMLElement>('.ant-file-card-list-remove').forEach((control,index)=>{
   control.setAttribute('role','button');control.setAttribute('tabindex','0');control.setAttribute('aria-label',`移除参考附件 ${index+1}`);
  });
  nameControls();const observer=new MutationObserver(nameControls);if(root.current)observer.observe(root.current,{childList:true,subtree:true});
  return()=>observer.disconnect();
 },[values]);
 const items=useMemo(()=>values.map((value,index)=>{
  const image=isReferenceImage(value),info=attachmentInfo(value);
  return {uid:`reference-${index}`,name:image?`参考图 ${index+1}`:info.name,'aria-label':image?`参考图 ${index+1}`:info.name,status:'done' as const,
   size:info.size,cardType:image?'image' as const:'file' as const,
   ...(image?{thumbUrl:value}:{description:'仅提供文件信息，尚未解析内容'})};
 }),[values]);
 return <div ref={root} onKeyDown={event=>{const control=(event.target as HTMLElement).closest<HTMLElement>('.ant-file-card-list-remove');if(control&&(event.key==='Enter'||event.key===' ')){event.preventDefault();control.click();}}}><Attachments ref={ref} className="reference-attachments" aria-label="参考附件" items={items}
  multiple disabled={disabled} overflow="scrollX"
  beforeUpload={(file,files)=>{if(file===files[0])onAdd(files);return Upload.LIST_IGNORE;}}
  onRemove={file=>{onRemove(Number(file.uid.slice('reference-'.length)));return false;}}/></div>;
});

/** Sent references use the same library's list and built-in image preview. */
export function MessageAttachments({values}:{values:string[]}){
 return <FileCard.List className="message-attachments" size="small" overflow="wrap" items={values.map((value,index)=>{
  const image=isReferenceImage(value),info=attachmentInfo(value);
  return {key:String(index),name:image?`参考图 ${index+1}`:info.name,'aria-label':image?`参考图 ${index+1}`:info.name,type:image?'image':'file',
   ...(image?{src:value}:{byte:info.size,description:'仅提供文件信息，尚未解析内容'})};
 })}/>;
}
