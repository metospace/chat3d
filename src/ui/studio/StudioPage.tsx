import {Children,isValidElement,type ComponentProps,type ReactNode} from 'react';
import {PageContainer} from '@ant-design/pro-components';
import {StudioPageHeader,type StudioPageHeaderProps} from './StudioPageHeader';
export function StudioPage({children,className='',...rest}:ComponentProps<'main'>&{children:ReactNode}){
 const parts=Children.toArray(children),heading=parts.find(child=>isValidElement<StudioPageHeaderProps>(child)&&child.type===StudioPageHeader);
 const header=isValidElement<StudioPageHeaderProps>(heading)?heading.props:undefined;
 return <main className={['studio-page',className,'pro-manager-page'].filter(Boolean).join(' ')} {...rest}>
  <PageContainer className="pro-studio-page" title={header?<h1>{header.title}</h1>:false} content={header?.description} extra={header?.actions} breadcrumbRender={false} pageHeaderRender={header?undefined:false}>
   {parts.filter(child=>child!==heading)}
  </PageContainer>
 </main>;
}
