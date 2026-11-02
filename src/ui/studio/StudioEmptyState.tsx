import type {ReactNode} from 'react';
import {Empty} from 'antd';
export function StudioEmptyState({title,description,actions,className=''}:{icon?:ReactNode;title:string;description?:string;actions?:ReactNode;className?:string}){
 return <Empty className={['studio-empty-state',className].filter(Boolean).join(' ')} image={Empty.PRESENTED_IMAGE_SIMPLE} description={<><h3>{title}</h3>{description&&<p>{description}</p>}</>}>{actions}</Empty>;
}
