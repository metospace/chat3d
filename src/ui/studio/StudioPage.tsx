import type {ComponentProps, ReactNode} from 'react';
import {ConfigProvider} from 'antd';

export function StudioPage({
  children,
  className = '',
  ...rest
}: ComponentProps<'main'> & {children: ReactNode}) {
  return (
    <ConfigProvider button={{autoInsertSpace: false}}>
      <main className={['studio-page', className].filter(Boolean).join(' ')} {...rest}>
        {children}
      </main>
    </ConfigProvider>
  );
}
