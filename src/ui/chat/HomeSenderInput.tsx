import {forwardRef,useImperativeHandle,useRef,type ComponentRef} from 'react';
import {Input,type GetProps} from 'antd';
type Props=GetProps<typeof Input.TextArea>;
type Ref={nativeElement:HTMLTextAreaElement|null;focus:(options?:{preventScroll?:boolean;cursor?:'start'|'end'|'all'})=>void;blur:()=>void;getValue:()=>{value:string;slotConfig:unknown[]}};
/** Sender's supported input slot keeps the editable field explicitly named. */
export const HomeSenderInput=forwardRef<Ref,Props>(function HomeSenderInput(props,ref){
 const area=useRef<ComponentRef<typeof Input.TextArea>>(null);
 useImperativeHandle(ref,()=>({nativeElement:area.current?.resizableTextArea?.textArea??null,focus:options=>area.current?.focus(options),blur:()=>area.current?.blur(),getValue:()=>({value:String(props.value??''),slotConfig:[]})}),[props.value]);
 return <Input.TextArea {...props} onKeyDown={event=>{if(event.nativeEvent.isComposing||event.keyCode===229)return;props.onKeyDown?.(event);}} ref={area} aria-label="新项目描述"/>;
});
