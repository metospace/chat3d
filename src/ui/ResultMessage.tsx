import {MessageText} from './MessageText';

/** One reading flow. Only separate outstanding checks are disclosed separately. */
export function ResultMessage({text}:{text:string}){
 const marker=text.search(/\n(?:仍需改进|已知问题|细节验收未完成)[：:]/);
 if(marker<0)return <div className="result-message"><MessageText text={text}/></div>;
 return <div className="result-message"><MessageText text={text.slice(0,marker)}/><details><summary>待核对项</summary><MessageText text={text.slice(marker).trim()}/></details></div>;
}
