import {ProCard} from '@ant-design/pro-components';
import type {ReactNode,HTMLAttributes} from 'react';

type StudioPanelProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  as?: 'section' | 'div';
  variant?: 'default' | 'flat';
  className?: string;
};

export function StudioPanel({children,as='section',variant='default',className='',...rest}:StudioPanelProps){
  const rootClass=['studio-panel',variant==='flat'?'studio-panel-flat':'',className].filter(Boolean).join(' ');
  if(as==='div')return <div className={rootClass} {...rest}><ProCard variant="borderless">{children}</ProCard></div>;
  return <section className={rootClass} {...rest}><ProCard variant="borderless">{children}</ProCard></section>;
}

export function StudioInsetCard({children,className='',...rest}:HTMLAttributes<HTMLDivElement>&{children:ReactNode}){
  return <div className={['studio-inset-card',className].filter(Boolean).join(' ')} {...rest}>{children}</div>;
}
