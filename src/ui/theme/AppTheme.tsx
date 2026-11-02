import {theme as antdTheme,type ThemeConfig} from 'antd';
import {XProvider} from '@ant-design/x';
import {shared,light,dark} from './designTokens';
import zhCN from 'antd/locale/zh_CN';
import {useMemo,type ComponentProps,type ReactNode} from 'react';
import {useAppearance} from '../appearanceContext';

type XThemeProp = NonNullable<ComponentProps<typeof XProvider>['theme']>;

/**
 * The single theme for the whole app: antd widgets and Ant Design X widgets read the
 * same tokens from designTokens.ts, which also populates CSS variables so light / dark
 * switching keeps one visual identity everywhere.
 */
function components():ThemeConfig['components']{
 return {Card:{borderRadiusLG:8},Modal:{borderRadiusLG:12},Tooltip:{fontSize:12},Popover:{borderRadiusLG:10}};
}

export function AppTheme({children}:{children:ReactNode}){
  const {resolved}=useAppearance();
  const isDark=resolved==='dark';
  const config=useMemo<ThemeConfig>(()=>({
    algorithm: isDark?antdTheme.darkAlgorithm:antdTheme.defaultAlgorithm,
    token: {...shared,...(isDark?dark:light)},
    cssVar: {key:'scenivo-pro-v6'},
    components: components(),
  }),[isDark]);
  return <XProvider variant="filled" locale={zhCN} theme={config as unknown as XThemeProp} button={{autoInsertSpace:false}}>{children}</XProvider>;
}
